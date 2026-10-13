package gloop

import System
import System.Buffers
import System.Collections.Generic
import System.Formats.Tar
import System.IO
import System.IO.Compression

class ArchiveService {
    private const PreviewByteLimit int64 = 16777216
    private const PreviewBufferSize int32 = 65536
    private const ListingCacheLimit int32 = 4096

    private let gate object = Object()
    private let previews Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
    private let active HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private let listings Dictionary[string, ValueTuple[DateTime, List[FileEntry]]] =
    Dictionary[string, ValueTuple[DateTime, List[FileEntry]]](StringComparer.Ordinal)

    shared {
        internal func Supported(path string) bool -> path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith(".tar", StringComparison.OrdinalIgnoreCase) || path.EndsWith(
            ".tar.gz",
            StringComparison.OrdinalIgnoreCase
        ) ||
            path.EndsWith(".tgz", StringComparison.OrdinalIgnoreCase)

        private func EntryPath(root string, name string) string {
            let normalized = name.Replace('\\', '/')

            if Path.IsPathRooted(normalized) {
                throw IOException("Unsafe archive entry: " + name)
            }

            for part in normalized.Split('/') {
                if part == ".." {
                    throw IOException("Unsafe archive entry: " + name)
                }
            }

            let path = Path.GetFullPath(Path.Combine(root, normalized))

            if !Locations.Contains(root, path) {
                throw IOException("Archive entry leaves destination: " + name)
            }

            return path
        }

        private func Unpack(source string, root string, selected string = "") {
            if source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
                using let archive = ZipFile.OpenRead(source)

                for entry in archive.Entries {
                    EntryPath(root, entry.FullName)
                }

                for entry in archive.Entries {
                    let path = EntryPath(root, entry.FullName)
                    let name = Path.GetRelativePath(root, path)

                    if selected != "" && name != selected && !name.StartsWith(
                        selected + "/",
                        StringComparison.Ordinal
                    ) {
                        continue
                    }
                    if ((entry.ExternalAttributes >> 16) & 61440) == 40960 {
                        throw IOException("Symbolic link is not supported in ZIP: " + entry.FullName)
                    }

                    if entry.FullName.Replace('\\', '/').EndsWith('/') {
                        Directory.CreateDirectory(path)
                    } else {
                        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)
                        using let input = entry.Open()
                        using let output = FileStream(path, FileMode.CreateNew, FileAccess.Write)
                        input.CopyTo(output)
                        File.SetUnixFileMode(path, UnixFileMode((entry.ExternalAttributes >> 16 & 511) | 384))
                    }
                }

                return
            }

            using let input = File.OpenRead(source)
            using let stream Stream = source.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
            ? input: GZipStream(input, CompressionMode.Decompress, true)
            using let reader = TarReader(stream, true)
            let links = List[TarEntry]()

            while let entry = reader.GetNextEntry() {
                if entry.EntryType == TarEntryType.GlobalExtendedAttributes {
                    continue
                }

                let path = EntryPath(root, entry.Name)
                let name = Path.GetRelativePath(root, path)

                if selected != "" && name != selected && !name.StartsWith(selected + "/", StringComparison.Ordinal) {
                    continue
                }

                if entry.EntryType == TarEntryType.SymbolicLink || entry.EntryType == TarEntryType.HardLink {
                    LinkTarget(root, path, entry.LinkName, entry.EntryType == TarEntryType.HardLink)

                    links.Add(entry)
                } else if entry.EntryType == TarEntryType.Directory {
                    Directory.CreateDirectory(path)
                } else if entry.EntryType == TarEntryType.RegularFile || entry.EntryType == TarEntryType.V7RegularFile {
                    Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)
                    using let output = FileStream(path, FileMode.CreateNew, FileAccess.Write)
                    entry.DataStream?.CopyTo(output)
                    File.SetUnixFileMode(path, UnixFileMode((int32(entry.Mode) & 511) | 384))
                } else {
                    throw IOException("Unsupported TAR entry: " + entry.Name + " (" + entry.EntryType.ToString() + ")")
                }
            }

            for entry in links {
                let path = EntryPath(root, entry.Name)
                let target = LinkTarget(root, path, entry.LinkName, entry.EntryType == TarEntryType.HardLink)
                Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)

                if entry.EntryType == TarEntryType.HardLink {
                    if File.GetAttributes(target).HasFlag(FileAttributes.ReparsePoint) {
                        throw IOException("Archive hard link target is a symbolic link: " + entry.Name)
                    }

                    File.Copy(target, path, false)
                } else {
                    File.CreateSymbolicLink(path, entry.LinkName)
                }
            }
        }

        private func LinkTarget(root string, path string, name string, hardLink bool) string {
            let normalized = name.Replace('\\', '/')

            if Path.IsPathRooted(normalized) {
                throw IOException("Archive link leaves destination: " + name)
            }

            var entered bool

            for part in normalized.Split('/') {
                if part == ".." && entered {
                    throw IOException("Unsafe archive link target: " + name)
                }

                if part != "" && part != "." && part != ".." {
                    entered = true
                }
            }

            let parent = Path.GetDirectoryName(path) ?? root
            let target = Path.GetFullPath(Path.Combine(hardLink ? root: parent, normalized))

            if !Locations.Contains(root, target) {
                throw IOException("Archive link leaves destination: " + name)
            }

            RequireLinkParents(root, parent)
            RequireLinkParents(root, Path.GetDirectoryName(target) ?? root)

            return target
        }

        private func RequireLinkParents(root string, parent string) {
            var current = parent

            while current != root && Locations.Contains(root, current) {
                if FileSystemService.Exists(current) && File.GetAttributes(current).HasFlag(
                    FileAttributes.ReparsePoint
                ) {
                    throw IOException("Archive link parent is a symbolic link: " + current)
                }

                current = Path.GetDirectoryName(current) ?? root
            }
        }

        private func Stem(path string) string {
            let name = Path.GetFileName(path)
            return name.EndsWith(".tar.gz", StringComparison.OrdinalIgnoreCase)
            ? name.Substring(0, name.Length - 7): Path.GetFileNameWithoutExtension(name)
        }
    }

    internal func Source(path string) string {
        var candidate = path

        while candidate != "" {
            if Supported(candidate) && File.Exists(candidate) {
                return candidate
            }

            candidate = Path.GetDirectoryName(candidate) ?? ""
        }

        return ""
    }

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

    internal func Preview(path string, cancelled Func[bool]? = nil) string {
        let source = Source(path)

        if source == "" || path == source {
            return path
        }

        lock gate {
            if !active.Contains(source) {
                throw OperationCanceledException()
            }

            if previews.TryGetValue(path, out var cached) && File.Exists(cached) {
                return cached
            }
        }

        {
            let root = Path.Combine(Path.GetTempPath(), "gloop-preview-" + Guid.NewGuid().ToString("N"))
            let target = Path.Combine(root, Path.GetFileName(path))

            lock gate {
                if !active.Contains(source) {
                    throw OperationCanceledException()
                }

                let expired = List[string]()

                for preview in previews {
                    if Source(preview.Key) == source {
                        let previous = Path.GetDirectoryName(preview.Value) ?? ""

                        if Directory.Exists(previous) {
                            Directory.Delete(previous, true)
                        }
                        expired.Add(preview.Key)
                    }
                }

                for previous in expired {
                    previews.Remove(previous)
                }

                Directory.CreateDirectory(root)
                File.SetUnixFileMode(root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
                previews[path] = target
            }
            let name = Path.GetRelativePath(source, path)

            try {
                if source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
                    using let archive = ZipFile.OpenRead(source)
                    let entry = FindZipEntry(archive, source, name, cancelled)

                    if entry.Length > PreviewByteLimit {
                        throw IOException("Archive preview exceeds 16 MiB: " + name)
                    }

                    using let input = entry.Open()
                    using let output = FileStream(target, FileMode.CreateNew, FileAccess.Write)
                    CopyPreview(input, output, cancelled)
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

                        if Path.GetRelativePath(source, EntryPath(source, entry.Name)) != name {
                            continue
                        }

                        if entry.Length > PreviewByteLimit {
                            throw IOException("Archive entry cannot be previewed: " + name)
                        }

                        guard let content = entry.DataStream else {
                            throw IOException("Archive entry cannot be previewed: " + name)
                        }

                        using let output = FileStream(target, FileMode.CreateNew, FileAccess.Write)
                        CopyPreview(content, output, cancelled)
                        break
                    }
                }

                if !File.Exists(target) {
                    throw IOException("Archive entry is unavailable: " + name)
                }

                lock gate {
                    if !active.Contains(source) {
                        throw OperationCanceledException()
                    }
                }

                return target
            } catch (failure Exception) {
                lock gate {
                    if previews.TryGetValue(path, out var current) && current == target {
                        previews.Remove(path)
                    }

                    if Directory.Exists(root) {
                        Directory.Delete(root, true)
                    }
                }
                rethrow
            }
        }
    }

    private func CopyPreview(input Stream, output Stream, cancelled Func[bool]?) {
        let buffer = ArrayPool[uint8].Shared.Rent(PreviewBufferSize)
        var total int64

        try {
            var count = input.Read(buffer, 0, buffer.Length)

            while count > 0 {
                if cancelled?.Invoke() == true {
                    throw OperationCanceledException()
                }

                total += count

                if total > PreviewByteLimit {
                    throw IOException("Archive preview exceeds 16 MiB")
                }

                output.Write(buffer, 0, count)
                count = input.Read(buffer, 0, buffer.Length)
            }
        } finally {
            ArrayPool[uint8].Shared.Return(buffer)
        }
    }

    private func FindZipEntry(archive ZipArchive, source string, name string, cancelled Func[bool]?) ZipArchiveEntry {
        for entry in archive.Entries {
            if cancelled?.Invoke() == true {
                throw OperationCanceledException()
            }

            if Path.GetRelativePath(source, EntryPath(source, entry.FullName)) == name {
                return entry
            }
        }

        throw IOException("Archive entry is unavailable: " + name)
    }

    internal func Extract(source string, destination string) OperationResult {
        let parent = Path.GetFullPath(destination)

        if !Directory.Exists(parent) {
            throw IOException("Destination folder is unavailable: " + parent)
        }

        let archive = Source(source)
        let name = Stem(archive)
        FileNames.Validate(name)
        let staging = Path.Combine(parent, ".gloop-extract-" + Guid.NewGuid().ToString("N"))
        let root = Path.Combine(staging, name)

        try {
            Directory.CreateDirectory(root)
            File.SetUnixFileMode(staging, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            let selected = source == archive ? "": Path.GetRelativePath(archive, source)
            Unpack(archive, root, selected)
            let entries = Directory.GetFileSystemEntries(root)

            if entries.Length == 0 {
                throw IOException("Archive is empty")
            }

            let from = selected != "" ? Path.Combine(root, selected): entries.Length == 1 ? entries[0]: root
            let finalPath = Path.Combine(parent, Path.GetFileName(from))
            let operations = FileOperationService()
            operations.RequireAbsent(finalPath)
            operations.MoveEntry(from, finalPath)

            return OperationResult{Source: source, FinalPath: finalPath, Error: ""}
        } finally {
            if Directory.Exists(staging) {
                Directory.Delete(staging, true)
            }
        }
    }

    internal func Compress(sources List[string], destination string, name string) OperationResult {
        FileNames.Validate(name)
        let fileName = Supported(name) ? name: name + ".zip"
        let path = Path.Combine(destination, fileName)
        let staging = Path.Combine(destination, ".gloop-archive-" + Guid.NewGuid().ToString("N"))
        let operations = FileOperationService()
        operations.RequireAbsent(path)

        try {
            {
                using let output = FileStream(staging, FileMode.CreateNew, FileAccess.Write)
                if fileName.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
                    using let archive = ZipArchive(output, ZipArchiveMode.Create, true)

                    for source in sources {
                        WriteZip(archive, source, Path.GetFileName(source))
                    }
                } else {
                    using let stream Stream = fileName.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
                    ? output: GZipStream(output, CompressionLevel.Optimal, true)
                    using let writer = TarWriter(stream, TarEntryFormat.Pax, true)

                    for source in sources {
                        WriteTar(writer, source, Path.GetFileName(source))
                    }
                }
            }

            return operations.Rename(staging, fileName)
        } finally {
            if File.Exists(staging) {
                File.Delete(staging)
            }
        }
    }

    private func WriteZip(archive ZipArchive, path string, name string) {
        let attributes = File.GetAttributes(path)

        if attributes.HasFlag(FileAttributes.ReparsePoint) {
            throw IOException("Compress failed for " + path + ": Symbolic links are not supported in ZIP")
        }

        if attributes.HasFlag(FileAttributes.Directory) {
            archive.CreateEntry(name + "/")

            for child in Directory.EnumerateFileSystemEntries(path) {
                WriteZip(archive, child, name + "/" + Path.GetFileName(child))
            }
        } else {
            FileOperationService().RequireRegularFile(path)
            archive.CreateEntryFromFile(path, name, CompressionLevel.Optimal)
        }
    }

    private func WriteTar(writer TarWriter, path string, name string) {
        let attributes = File.GetAttributes(path)

        if !attributes.HasFlag(FileAttributes.Directory) && !attributes.HasFlag(FileAttributes.ReparsePoint) {
            FileOperationService().RequireRegularFile(path)
        }

        writer.WriteEntry(path, name)

        if attributes.HasFlag(FileAttributes.Directory) && !attributes.HasFlag(FileAttributes.ReparsePoint) {
            for child in Directory.EnumerateFileSystemEntries(path) {
                WriteTar(writer, child, name + "/" + Path.GetFileName(child))
            }
        }
    }

    internal func ReleaseUnused(panes List[BrowserPane]) {
        lock gate {
            active.Clear()

            for pane in panes {
                if pane.Kind == LocationKind.Archive {
                    active.Add(Source(pane.DirectoryPath))
                }
            }

            let expired = List[string]()

            for preview in previews {
                if !active.Contains(Source(preview.Key)) {
                    let root = Path.GetDirectoryName(preview.Value) ?? ""

                    if Directory.Exists(root) {
                        Directory.Delete(root, true)
                    }
                    expired.Add(preview.Key)
                }
            }

            for path in expired {
                previews.Remove(path)
            }

            expired.Clear()

            for source in listings.Keys {
                if !active.Contains(source) {
                    expired.Add(source)
                }
            }

            for source in expired {
                listings.Remove(source)
            }
        }
    }

    internal func Close() {
        lock gate {
            active.Clear()

            for preview in previews.Values {
                let root = Path.GetDirectoryName(preview) ?? ""

                if Directory.Exists(root) {
                    Directory.Delete(root, true)
                }
            }

            previews.Clear()
            listings.Clear()
        }
    }
}
