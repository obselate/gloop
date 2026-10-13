package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.IO.Enumeration
import System.Runtime.InteropServices
import System.Text

unsafe class FileSystemService {
    private const RecentEntryLimit int32 = 200
    private const PreviewByteLimit int32 = 4194304
    private const PreviewLineByteLimit int32 = 16384
    private const CancellationCheckCharacters int32 = 65536
    private const TextProbeBytes int32 = 8192
    internal const BytesPerKiB int64 = 1024
    internal const BytesPerMiB int64 = 1048576
    private const BytesPerGiB int64 = 1073741824

    internal func List(path string, kind LocationKind, atTrashRoot bool, showHidden bool) DirectorySnapshot {
        let snapshot = DirectorySnapshot{DirectoryPath: path}
        if kind == LocationKind.Recent {
            for entry in RecentService().List(RecentEntryLimit) {
                if showHidden || !entry.Name.StartsWith('.') {
                    snapshot.Entries.Add(entry)
                }
            }
            return snapshot
        }
        try {
            if atTrashRoot && !Directory.Exists(snapshot.DirectoryPath) {
                return snapshot
            }
            let kinds = Dictionary[string, string](StringComparer.OrdinalIgnoreCase)
            let options = EnumerationOptions()
            options.AttributesToSkip = FileAttributes(0)
            options.IgnoreInaccessible = false
            let enumeration = FileSystemEnumerable[FileEntry](
                snapshot.DirectoryPath,
                (ref raw FileSystemEntry) -> readEntry(ref raw, kinds),
                options
            )
            if !showHidden {
                enumeration.ShouldIncludePredicate = (ref raw FileSystemEntry) ->
                raw.FileName.Length == 0 || raw.FileName[0] != '.'
            }
            for item in enumeration {
                snapshot.Entries.Add(item)
            }
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            snapshot.Error = "List folder failed for " + path + ": " + failure.Message
        }
        return snapshot
    }

    internal func Sort(entries List[FileEntry], column SortColumn, descending bool) List[FileEntry] {
        let sorted = System.Collections.Generic.List[FileEntry](entries)
        SortInPlace(sorted, column, descending)
        return sorted
    }

    internal func SortInPlace(entries List[FileEntry], column SortColumn, descending bool) {
        entries.Sort((left FileEntry, right FileEntry) -> compare(left, right, column, descending))
    }

    internal func ReadPreview(path string, cancelled Func[bool]) PreviewData {
        try {
            let fullPath = Path.GetFullPath(path)
            let attributes = File.GetAttributes(fullPath)
            let name = Path.GetFileName(fullPath)
            if attributes.HasFlag(FileAttributes.ReparsePoint) {
                return PreviewData{Kind: PreviewKind.Metadata, Text: "Symbolic link", Path: fullPath}
            }
            if attributes.HasFlag(FileAttributes.Directory) {
                return PreviewData{Kind: PreviewKind.Metadata, Text: "Folder", Path: fullPath}
            }
            let size = FileInfo(fullPath).Length
            let extension = Path.GetExtension(name).ToLowerInvariant()
            if FileKinds.IsImage(extension) {
                return PreviewData{Kind: PreviewKind.Image, Text: FormatSize(size), Path: fullPath}
            }
            if !FileKinds.IsText(extension) && !hasTextPrefix(fullPath, size) {
                return PreviewData{Kind: PreviewKind.Metadata, Text: FormatSize(size), Path: fullPath}
            }
            if size == 0 {
                return PreviewData{Kind: PreviewKind.Text, Text: "", Path: fullPath,}
            }
            let limit = int32(Math.Min(size, int64(PreviewByteLimit)))
            let buffer = [limit]uint8
            var count int32 = 0
            using let stream = FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
            while count < limit {
                if cancelled() {
                    throw OperationCanceledException()
                }
                let read = stream.Read(buffer, count, buffer.Length - count)
                if read == 0 {
                    break
                }
                count += read
            }
            let sourceTruncated = size > int64(count)
            if TextContent.HasBinaryBytes(buffer, count, cancelled: cancelled) {
                return PreviewData{
                    Kind: PreviewKind.Metadata,
                    Text: "Binary file · " + FormatSize(size),
                    Path: fullPath
                }
            }
            if sourceTruncated {
                count = TextContent.CompleteUtf8Length(buffer, count)
            }
            let decoded = TextContent.Decode(buffer, count)
            let content = NormalizePreview(decoded, cancelled, out var shortened)
            let language = PreviewSyntaxService.DetectLanguage(extension, content)
            let highlighting = PreviewSyntaxService.Highlight(content, language, cancelled)
            var warning = ""
            if sourceTruncated {
                warning = "Preview limited to the first " + (PreviewByteLimit / BytesPerMiB).ToString() + " MiB."
            }
            if shortened {
                warning += " Lines over " + (PreviewLineByteLimit / BytesPerKiB).ToString() + " KiB were shortened."
            }
            if highlighting.Limited {
                warning += " Syntax highlighting was limited."
            }
            return PreviewData{
                Kind: PreviewKind.Text,
                Text: content,
                Path: fullPath,
                Warning: warning.Trim(),
                Styles: highlighting.Spans,
            }
        } catch (failure OperationCanceledException) {
            return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
        } catch (failure DecoderFallbackException) {
            return PreviewData{Kind: PreviewKind.Metadata, Text: "Binary file", Path: path}
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            return PreviewData{
                Kind: PreviewKind.Error,
                Path: path,
                Error: "Preview failed for " + path + ": " + failure.Message
            }
        }
    }

    private func NormalizePreview(decoded string, cancelled Func[bool], out shortened bool) string {
        let normalized = StringBuilder(decoded.Length)
        var lineBytes = 0
        shortened = false
        var lineShortened = false
        var index = 0
        var lastCheck = 0
        while index < decoded.Length {
            if index - lastCheck >= CancellationCheckCharacters {
                if cancelled() {
                    throw OperationCanceledException()
                }
                lastCheck = index
            }
            let character = decoded[index]
            if character == '\r' || character == '\n' {
                normalized.Append('\n')
                if character == '\r' && index + 1 < decoded.Length && decoded[index + 1] == '\n' {
                    index++
                }
                lineBytes = 0
                lineShortened = false
            } else if !lineShortened {
                let width = if character <= 127 {
                    1
                } else if character <= 2047 {
                    2
                } else if Char.IsHighSurrogate(character) {
                    4
                } else if Char.IsLowSurrogate(character) {
                    0
                } else {
                    3
                }
                if lineBytes + width <= PreviewLineByteLimit {
                    normalized.Append(character)
                    lineBytes += width
                } else {
                    normalized.Append('…')
                    shortened = true
                    lineShortened = true
                }
            }
            index++
        }
        return normalized.ToString()
    }

    private func hasTextPrefix(path string, size int64) bool {
        if size == 0 {
            return false
        }
        using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
        let buffer = [TextProbeBytes]uint8
        var count = stream.Read(buffer, 0, buffer.Length)
        if size > int64(count) {
            count = TextContent.CompleteUtf8Length(buffer, count)
        }
        return TextContent.IsText(buffer, count)
    }

    internal func Open(path string) string {
        try {
            let fullPath = Path.GetFullPath(path)
            File.GetAttributes(fullPath)
            let start = ProcessStartInfo("xdg-open")
            start.ArgumentList.Add(fullPath)
            start.UseShellExecute = false
            let process = Process.Start(start)
            guard let launched = process else {
                return "Open failed for " + path + ": xdg-open did not start"
            }
            launched.Dispose()
            return ""
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is System
            .ComponentModel
            .Win32Exception ||
            failure is ArgumentException {
            return "Open failed for " + path + ": " + failure.Message
        }
    }

    shared {
        internal const AtCurrentDirectory int32 = -100
        internal const AtSymlinkNoFollow int32 = 256
        internal const AtEffectiveAccess int32 = 512
        internal const StatBufferSize int32 = 256
        internal const StatType uint32 = 1u
        internal const StatMode uint32 = 2u
        internal const StatUid uint32 = 8u
        internal const StatGid uint32 = 16u
        internal const StatBirthTime uint32 = 2048u
        internal const FileTypeMask int32 = 61440
        internal const RegularFileType int32 = 32768
        internal const DirectoryFileType int32 = 16384

        @DllImport("libc", EntryPoint: "statx", CharSet: CharSet.Ansi, SetLastError: true)
        internal func ReadStat(directory int32, path string, flags int32, mask uint32, buffer IntPtr) int32;

        internal func Exists(path string) bool {
            try {
                File.GetAttributes(path)
                return true
            } catch (failure Exception) when failure is FileNotFoundException || failure is DirectoryNotFoundException {
                return false
            }
        }

        internal func Remove(path string) {
            let attributes = File.GetAttributes(path)
            if attributes.HasFlag(FileAttributes.Directory) {
                if !attributes.HasFlag(FileAttributes.ReparsePoint) {
                    for child in Directory.EnumerateFileSystemEntries(path) {
                        Remove(child)
                    }
                }
                Directory.Delete(path, false)
            } else {
                File.Delete(path)
            }
        }

        internal func FormatSize(size int64, rounded bool = false) string {
            if size < BytesPerKiB {
                return size.ToString() + " B"
            }
            if size < BytesPerMiB {
                let value = float64(size) / BytesPerKiB
                return (rounded ? Math.Round(value): value).ToString(
                    rounded ? "0": "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KiB"
            }
            if size < BytesPerGiB {
                let value = float64(size) / BytesPerMiB
                return (rounded ? Math.Round(value): value).ToString(
                    rounded ? "0": "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " MiB"
            }
            let value = float64(size) / BytesPerGiB
            return (rounded ? Math.Round(value): value).ToString(rounded ? "0": "0.0", CultureInfo.InvariantCulture) +
                " GiB"
        }
    }

    private func readEntry(ref raw FileSystemEntry, kinds Dictionary[string, string]) FileEntry {
        let name = raw.FileName.ToString()
        var entry = FileEntry{Name: name, FullPath: raw.ToFullPath(), Kind: "File"}
        try {
            let attributes = raw.Attributes
            entry.IsDirectory = attributes.HasFlag(FileAttributes.Directory)
            entry.IsSymlink = attributes.HasFlag(FileAttributes.ReparsePoint)
            entry.Modified = raw.LastWriteTimeUtc.LocalDateTime
            if entry.IsSymlink || entry.IsDirectory {
                entry.Kind = FileKinds.EntryKind("", entry.IsDirectory, entry.IsSymlink)
            } else {
                entry.Size = raw.Length
                let extension = Path.GetExtension(name)
                if extension != "" {
                    if !kinds.TryGetValue(extension, out var kind) {
                        kind = FileKinds.EntryKind(extension)
                        kinds.Add(extension, kind)
                    }
                    entry.Kind = kind
                }
            }
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            entry.Kind = "Read metadata failed for " + name + ": " + failure.Message
        }
        return entry
    }

    private func compare(left FileEntry, right FileEntry, column SortColumn, descending bool) int32 {
        if left.IsDirectory != right.IsDirectory {
            return left.IsDirectory ? -1: 1
        }
        var result int32 = 0
        if column == SortColumn.Size {
            result = left.Size.CompareTo(right.Size)
        } else if column == SortColumn.Modified {
            result = left.Modified.CompareTo(right.Modified)
        } else if column == SortColumn.Kind {
            result = String.Compare(left.Kind, right.Kind, StringComparison.OrdinalIgnoreCase)
        } else {
            result = String.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase)
        }
        if result == 0 {
            result = String.Compare(left.Name, right.Name, StringComparison.OrdinalIgnoreCase)
        }
        if result == 0 {
            result = String.Compare(left.Name, right.Name, StringComparison.Ordinal)
        }
        return descending ? -result: result
    }
}
