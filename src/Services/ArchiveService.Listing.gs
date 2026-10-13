package gloop

import System
import System.Collections.Generic
import System.Formats.Tar
import System.IO
import System.IO.Compression

partial class ArchiveService {
    private const ListingCacheLimit int32 = 4096

    private let listings Dictionary[string, ValueTuple[DateTime, List[FileEntry]]] =
    Dictionary[string, ValueTuple[DateTime, List[FileEntry]]](StringComparer.Ordinal)

    internal func ListArchive(path string, showHidden bool, cancelled Func[bool]? = nil) DirectorySnapshot {
        let source = Source(path)
        let prefix = path == source ? "": Path.GetRelativePath(source, path).TrimEnd('/') + "/"
        let snapshot = DirectorySnapshot{DirectoryPath: path}
        let names = HashSet[string](StringComparer.Ordinal)
        let modified = File.GetLastWriteTimeUtc(source)
        var cached ValueTuple[DateTime, List[FileEntry]]
        var found bool

        lock gate {
            found = listings.TryGetValue(source, out cached)
        }

        if found && cached.Item1 == modified {
            for entry in cached.Item2 {
                if cancelled?.Invoke() == true {
                    throw OperationCanceledException()
                }

                AddEntry(snapshot, names, source, prefix, entry.Name, entry.Size, entry.Modified, showHidden)
            }

            return snapshot
        }

        let entries = List[FileEntry]()

        if source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
            using let archive = ZipFile.OpenRead(source)

            for entry in archive.Entries {
                if cancelled?.Invoke() == true {
                    throw OperationCanceledException()
                }

                AddEntry(
                    snapshot,
                    names,
                    source,
                    prefix,
                    entry.FullName,
                    entry.Length,
                    entry.LastWriteTime.DateTime,
                    showHidden,
                    entries
                )
            }
        } else {
            using let input = File.OpenRead(source)
            using let stream Stream = source.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
            ? input: GZipStream(input, CompressionMode.Decompress, true)
            using let reader = TarReader(stream, true)

            while let entry = reader.GetNextEntry() {
                if cancelled?.Invoke() == true {
                    throw OperationCanceledException()
                }

                if entry.EntryType == TarEntryType.GlobalExtendedAttributes {
                    continue
                }

                AddEntry(
                    snapshot,
                    names,
                    source,
                    prefix,
                    entry.Name,
                    entry.Length,
                    entry.ModificationTime.DateTime,
                    showHidden,
                    entries
                )
            }
        }

        if entries.Count <= ListingCacheLimit {
            lock gate {
                if active.Contains(source) {
                    listings[source] = ValueTuple[DateTime, List[FileEntry]](modified, entries)
                }
            }
        }

        return snapshot
    }

    private func AddEntry(
        snapshot DirectorySnapshot,
        names HashSet[string],
        source string,
        prefix string,
        name string,
        size int64,
        modified DateTime,
        showHidden bool,
        cache List[FileEntry]? = nil
    ) {
        let normalized = Path.GetRelativePath(source, EntryPath(source, name))

        if let entries = cache {
            if entries.Count <= ListingCacheLimit {
                entries.Add(FileEntry{Name: name, Size: size, Modified: modified})
            }
        }

        if normalized == "." {
            return
        }

        if !normalized.StartsWith(prefix, StringComparison.Ordinal) {
            return
        }

        let relative = normalized.Substring(prefix.Length)
        let slash = relative.IndexOf('/')
        let directory = slash >= 0 || name.Replace('\\', '/').EndsWith('/')
        let child = slash < 0 ? relative: relative.Substring(0, slash)

        if child == "" || (!showHidden && child.StartsWith('.')) || !names.Add(child) {
            return
        }

        snapshot.Entries.Add(
            FileEntry{
                Name: child,
                FullPath: Path.Combine(snapshot.DirectoryPath, child),
                IsDirectory: directory,
                Size: directory ? 0: size,
                Modified: modified,
                Kind: directory ? "Folder": Path.GetExtension(child).TrimStart('.'),
            }
        )
    }
}
