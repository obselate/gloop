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
    internal func List(path string, kind LocationKind, atTrashRoot bool, showHidden bool) DirectorySnapshot {
        let snapshot = DirectorySnapshot{DirectoryPath: path}
        if kind == LocationKind.Recent {
            for entry in RecentService().List(200) {
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
        } catch (failure Exception) {
            snapshot.Error = failure.Message
        }
        return snapshot
    }

    internal func Sort(entries List[FileEntry], column string, descending bool) List[FileEntry] {
        let sorted = System.Collections.Generic.List[FileEntry](entries)
        SortInPlace(sorted, column, descending)
        return sorted
    }

    internal func SortInPlace(entries List[FileEntry], column string, descending bool) {
        entries.Sort((left FileEntry, right FileEntry) -> compare(left, right, column, descending))
    }

    internal func ReadPreview(path string, cancelled Func[bool]) PreviewData {
        try {
            let fullPath = Path.GetFullPath(path)
            let attributes = File.GetAttributes(fullPath)
            let name = Path.GetFileName(fullPath)
            if attributes.HasFlag(FileAttributes.ReparsePoint) {
                return PreviewData{Kind: "metadata", Text: "Symbolic link", Path: fullPath}
            }
            if attributes.HasFlag(FileAttributes.Directory) {
                return PreviewData{Kind: "metadata", Text: "Folder", Path: fullPath}
            }
            let size = FileInfo(fullPath).Length
            let extension = Path.GetExtension(name).ToLowerInvariant()
            if FileKinds.IsImage(extension) {
                return PreviewData{Kind: "image", Text: FormatSize(size), Path: fullPath}
            }
            if !FileKinds.IsText(extension) && !hasTextPrefix(fullPath, size) {
                return PreviewData{Kind: "metadata", Text: FormatSize(size), Path: fullPath}
            }
            if size == 0 {
                return PreviewData{Kind: "text", Text: "", Path: fullPath,}
            }
            let limit = int32(Math.Min(size, int64(4194304)))
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
                return PreviewData{Kind: "metadata", Text: "Binary file · " + FormatSize(size), Path: fullPath}
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
                warning = "Preview limited to the first 4 MiB."
            }
            if shortened {
                warning += " Lines over 16 KiB were shortened."
            }
            if highlighting.Limited {
                warning += " Syntax highlighting was limited."
            }
            return PreviewData{
                Kind: "text",
                Text: content,
                Path: fullPath,
                Warning: warning.Trim(),
                Styles: highlighting.Spans,
            }
        } catch (failure OperationCanceledException) {
            return PreviewData{Kind: "cancelled", Path: path}
        } catch (failure DecoderFallbackException) {
            return PreviewData{Kind: "metadata", Text: "Binary file", Path: path}
        } catch (failure Exception) {
            return PreviewData{Kind: "error", Text: "", Path: path, Error: failure.Message}
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
            if index - lastCheck >= 65536 {
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
                if lineBytes + width <= 16384 {
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
        try {
            using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
            let buffer = [8192]uint8
            var count = stream.Read(buffer, 0, buffer.Length)
            if size > int64(count) {
                count = TextContent.CompleteUtf8Length(buffer, count)
            }
            return TextContent.IsText(buffer, count)
        } catch (failure Exception) {
            return false
        }
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
                return "Could not launch xdg-open"
            }
            launched.Dispose()
            return ""
        } catch (failure Exception) {
            return failure.Message
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
            } catch (failure FileNotFoundException) {
                return false
            } catch (failure DirectoryNotFoundException) {
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
            if size < 1024 {
                return size.ToString() + " B"
            }
            if size < 1048576 {
                let value = float64(size) / 1024
                return (rounded ? Math.Round(value): value).ToString(
                    rounded ? "0": "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " KiB"
            }
            if size < 1073741824 {
                let value = float64(size) / 1048576
                return (rounded ? Math.Round(value): value).ToString(
                    rounded ? "0": "0.0",
                    CultureInfo.InvariantCulture
                ) +
                    " MiB"
            }
            let value = float64(size) / 1073741824
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
        } catch (failure Exception) {
            entry.Kind = "Unavailable"
        }
        return entry
    }

    private func compare(left FileEntry, right FileEntry, column string, descending bool) int32 {
        if left.IsDirectory != right.IsDirectory {
            return left.IsDirectory ? -1: 1
        }
        var result int32 = 0
        if column == "size" {
            result = left.Size.CompareTo(right.Size)
        } else if column == "modified" {
            result = left.Modified.CompareTo(right.Modified)
        } else if column == "kind" {
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
