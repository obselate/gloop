package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.Globalization
import System.IO
import System.Text

class FileSystemService {
    internal func List(path string, showHidden bool) DirectorySnapshot {
        let snapshot = DirectorySnapshot{}
        try {
            snapshot.DirectoryPath = Path.GetFullPath(path)
            for item in DirectoryInfo(snapshot.DirectoryPath).EnumerateFileSystemInfos() {
                if !showHidden && item.Name.StartsWith(".") {
                    continue
                }
                snapshot.Entries.Add(readEntry(item))
            }
        } catch (failure Exception) {
            snapshot.Error = failure.Message
        }
        return snapshot
    }

    internal func Sort(entries List[FileEntry], column string, descending bool) List[FileEntry] {
        let sorted = System.Collections.Generic.List[FileEntry](entries)
        sorted.Sort((left FileEntry, right FileEntry) -> compare(left, right, column, descending))
        return sorted
    }

    internal func ReadPreview(path string, cancelled Func[bool]) PreviewData {
        try {
            let fullPath = Path.GetFullPath(path)
            let attributes = File.GetAttributes(fullPath)
            let name = Path.GetFileName(fullPath)
            if hasAttribute(attributes, FileAttributes.ReparsePoint) {
                return PreviewData{Kind: "metadata", Text: "Symbolic link", Path: fullPath}
            }
            if hasAttribute(attributes, FileAttributes.Directory) {
                return PreviewData{Kind: "metadata", Text: "Folder", Path: fullPath}
            }
            let size = FileInfo(fullPath).Length
            let extension = Path.GetExtension(name).ToLowerInvariant()
            if isImage(extension) {
                return PreviewData{Kind: "image", Text: FormatSize(size), Path: fullPath}
            }
            if !isText(extension) {
                return PreviewData{Kind: "metadata", Text: FormatSize(size), Path: fullPath}
            }
            if size == 0 {
                return PreviewData{
                    Kind: "text",
                    Text: "",
                    Path: fullPath,
                    Language: PreviewSyntaxService.LanguageFor(extension),
                }
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
            for index in 0 ... count {
                if (index & 65535) == 0 && cancelled() {
                    throw OperationCanceledException()
                }
                if buffer[index] == 0 {
                    return PreviewData{Kind: "metadata", Text: "Binary file · " + FormatSize(size), Path: fullPath}
                }
            }
            if sourceTruncated {
                count = completeUtf8Length(buffer, count)
            }
            let start = if count >= 3 && buffer[0] == 239 && buffer[1] == 187 && buffer[2] == 191 {
                3
            } else {
                0
            }
            let decoded = UTF8Encoding(false, true).GetString(buffer, start, count - start)
            let normalized = StringBuilder(decoded.Length)
            var lineBytes = 0
            var shortened = false
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
            let content = normalized.ToString()
            let language = PreviewSyntaxService.LanguageFor(extension)
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
                Language: language,
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

    private func completeUtf8Length(buffer[]uint8, count int32) int32 {
        if count == 0 {
            return count
        }
        var start = count - 1
        while start > 0 && (int32(buffer[start]) & 192) == 128 {
            start--
        }
        let lead = int32(buffer[start])
        let width = if lead < 128 {
            1
        } else if (lead & 224) == 192 {
            2
        } else if (lead & 240) == 224 {
            3
        } else if (lead & 248) == 240 {
            4
        } else {
            1
        }
        return if start + width > count {
            start
        } else {
            count
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
        internal func FormatSize(size int64) string {
            if size < 1024 {
                return size.ToString() + " B"
            }
            if size < 1048576 {
                return (float64(size) / 1024).ToString("0.0", CultureInfo.InvariantCulture) + " KiB"
            }
            if size < 1073741824 {
                return (float64(size) / 1048576).ToString("0.0", CultureInfo.InvariantCulture) + " MiB"
            }
            return (float64(size) / 1073741824).ToString("0.0", CultureInfo.InvariantCulture) + " GiB"
        }
    }

    private func readEntry(info FileSystemInfo) FileEntry {
        var entry = FileEntry{Name: info.Name, FullPath: info.FullName, Kind: "File"}
        try {
            let attributes = info.Attributes
            entry.IsDirectory = hasAttribute(attributes, FileAttributes.Directory)
            entry.IsSymlink = hasAttribute(attributes, FileAttributes.ReparsePoint)
            entry.Modified = info.LastWriteTime
            if entry.IsSymlink {
                entry.Kind = "Link"
            } else if entry.IsDirectory {
                entry.Kind = "Folder"
            } else {
                if info is FileInfo {
                    entry.Size = info.Length
                }
                let extension = Path.GetExtension(info.Name)
                if extension != "" {
                    entry.Kind = extension.Substring(1).ToUpperInvariant() + " file"
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

    private func hasAttribute(value FileAttributes, flag FileAttributes) bool -> (int32(value) & int32(flag)) != 0

    private func isImage(extension string) bool -> extension == ".png" || extension == ".jpg"
    || extension == ".jpeg" || extension == ".gif"

    private func isText(extension string) bool -> extension == "" ||
        extension == ".txt" ||
        extension == ".md" ||
        extension == ".log"
    || extension == ".json" || extension == ".yaml" || extension == ".yml"
    || extension == ".toml" || extension == ".xml" || extension == ".html"
    || extension == ".css" || extension == ".js" || extension == ".ts"
    || extension == ".gs" || extension == ".cs" || extension == ".sh"
    || extension == ".py" || extension == ".rs" || extension == ".go"
}
