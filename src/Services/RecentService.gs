package gloop

import System
import System.Collections.Generic
import System.Globalization
import System.IO

class RecentService {
    private const SourceByteLimit int64 = 16777216
    private const EntryLimit int32 = 1000

    internal func List(limit int32) List[FileEntry] {
        let entries = System.Collections.Generic.List[FileEntry]()

        try {
            let source = Path.Combine(Xdg.UserDirectory("XDG_DATA_HOME", ".local/share"), "recently-used.xbel")

            if limit <= 0 || FileInfo(source).Length > SourceByteLimit {
                return entries
            }

            let text = File.ReadAllText(source)
            let moments = Dictionary[string, DateTime]()
            var index = text.IndexOf("<bookmark ", StringComparison.Ordinal)

            while index >= 0 {
                let end = text.IndexOf('>', index)

                if end < 0 {
                    break
                }

                let tag = text.Substring(index, end - index)
                let path = localPath(attribute(tag, "href"))

                if path != "" {
                    let moment = latest(attribute(tag, "modified"), attribute(tag, "visited"))

                    if !moments.TryGetValue(path, out var known) || moment > known {
                        moments[path] = moment
                    }
                }

                index = text.IndexOf("<bookmark ", end, StringComparison.Ordinal)
            }

            let paths = System.Collections.Generic.List[string](moments.Keys)
            paths.Sort(
                (left string, right string) -> {
                    let order = moments[right].CompareTo(moments[left])

                    return order != 0 ? order: String.CompareOrdinal(left, right)
                }
            )

            for path in paths {
                if entries.Count >= Math.Min(limit, EntryLimit) {
                    break
                }

                try {
                    entries.Add(readEntry(path))
                } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException { }
            }
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException { }

        return entries
    }

    private func attribute(tag string, name string) string {
        let marker = " " + name + "=\""
        let start = tag.IndexOf(marker, StringComparison.Ordinal)

        if start < 0 {
            return ""
        }

        let from = start + marker.Length
        let end = tag.IndexOf('"', from)

        return end < 0 ? "": tag.Substring(from, end - from)
    }

    private func localPath(href string) string {
        var rest = ""

        if href.StartsWith("file:///", StringComparison.Ordinal) {
            rest = href.Substring(7)
        } else if href.StartsWith("file://localhost/", StringComparison.Ordinal) {
            rest = href.Substring(16)
        } else {
            return ""
        }

        try {
            let markup = rest.Replace("&lt;", "<").Replace("&gt;", ">").Replace("&quot;", "\"").Replace("&apos;", "'")

            return Path.TrimEndingDirectorySeparator(
                Path.GetFullPath(Uri.UnescapeDataString(markup.Replace("&amp;", "&")))
            )
        } catch (failure ArgumentException) {
            return ""
        }
    }

    private func latest(modified string, visited string) DateTime {
        let first = moment(modified)
        let second = moment(visited)

        return first > second ? first: second
    }

    private func moment(value string) DateTime {
        let styles = DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal

        return DateTime.TryParse(
            value,
            CultureInfo.InvariantCulture,
            styles,
            out var parsed
        ) ? parsed: DateTime.MinValue
    }

    private func readEntry(path string) FileEntry {
        let attributes = File.GetAttributes(path)
        var entry = FileEntry{
            Name: Path.GetFileName(path),
            FullPath: path,
            IsDirectory: attributes.HasFlag(FileAttributes.Directory),
            IsSymlink: attributes.HasFlag(FileAttributes.ReparsePoint),
            Modified: File.GetLastWriteTimeUtc(path).ToLocalTime(),
            Kind: "File",
        }
        entry.Kind = FileKinds.EntryKind(Path.GetExtension(entry.Name), entry.IsDirectory, entry.IsSymlink)

        if !entry.IsSymlink && !entry.IsDirectory {
            entry.Size = FileInfo(path).Length
        }

        return entry
    }
}
