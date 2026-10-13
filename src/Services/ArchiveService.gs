package gloop

import System
import System.Collections.Generic
import System.Formats.Tar
import System.IO
import System.IO.Compression

class ArchiveService {
    private let gate object = Object()
    private let previews Dictionary[string, string] = Dictionary[string, string](StringComparer.Ordinal)
    private let active HashSet[string] = HashSet[string](StringComparer.Ordinal)

    shared {
        internal func Supported(path string) bool -> path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ||
            path.EndsWith(".tar", StringComparison.OrdinalIgnoreCase) || path.EndsWith(
            ".tar.gz",
            StringComparison.OrdinalIgnoreCase
        ) ||
            path.EndsWith(".tgz", StringComparison.OrdinalIgnoreCase)

        private func EntryPath(root string, name string) string {
            let normalized = name.Replace('\\', '/')

            if Path.IsPathRooted(normalized) || normalized.Contains(':') {
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

                    if ((entry.ExternalAttributes >> 16) & 61440) == 40960 {
                        throw IOException("Symbolic link is not supported in ZIP: " + entry.FullName)
                    }
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

                    if entry.FullName.EndsWith('/') {
                        Directory.CreateDirectory(path)
                    } else {
                        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)
                        using let input = entry.Open()
                        using let output = FileStream(path, FileMode.CreateNew, FileAccess.Write)
                        input.CopyTo(output)
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
                let path = EntryPath(root, entry.Name)
                let name = Path.GetRelativePath(root, path)

                if selected != "" && name != selected && !name.StartsWith(selected + "/", StringComparison.Ordinal) {
                    continue
                }

                if entry.EntryType == TarEntryType.SymbolicLink || entry.EntryType == TarEntryType.HardLink {
                    let basePath = entry.EntryType == TarEntryType.HardLink ? root: Path.GetDirectoryName(path) ?? root
                    EntryPath(basePath, entry.LinkName)
                    let target = Path.GetFullPath(Path.Combine(basePath, entry.LinkName))

                    if !Locations.Contains(root, target) {
                        throw IOException("Archive link leaves destination: " + entry.Name)
                    }

                    links.Add(entry)
                } else if entry.EntryType == TarEntryType.Directory {
                    Directory.CreateDirectory(path)
                } else if entry.EntryType == TarEntryType.RegularFile || entry.EntryType == TarEntryType.V7RegularFile {
                    Directory.CreateDirectory(Path.GetDirectoryName(path) ?? root)
                    using let output = FileStream(path, FileMode.CreateNew, FileAccess.Write)
                    entry.DataStream?.CopyTo(output)
                } else {
                    throw IOException("Unsupported TAR entry: " + entry.Name + " (" + entry.EntryType.ToString() + ")")
                }
            }

            for entry in links {
                let path = EntryPath(root, entry.Name)
                let basePath = entry.EntryType == TarEntryType.HardLink ? root: Path.GetDirectoryName(path) ?? root
                let target = Path.GetFullPath(Path.Combine(basePath, entry.LinkName))
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

    internal func ListArchive(path string, showHidden bool) DirectorySnapshot {
        let source = Source(path)
        let prefix = path == source ? "": Path.GetRelativePath(source, path).TrimEnd('/') + "/"
        let snapshot = DirectorySnapshot{DirectoryPath: path}
        let names = HashSet[string](StringComparer.Ordinal)

        if source.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
            using let archive = ZipFile.OpenRead(source)

            for entry in archive.Entries {
                AddEntry(
                    snapshot,
                    names,
                    source,
                    prefix,
                    entry.FullName,
                    entry.Length,
                    entry.LastWriteTime.DateTime,
                    showHidden
                )
            }
        } else {
            using let input = File.OpenRead(source)
            using let stream Stream = source.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
            ? input: GZipStream(input, CompressionMode.Decompress, true)
            using let reader = TarReader(stream, true)

            while let entry = reader.GetNextEntry() {
                AddEntry(
                    snapshot,
                    names,
                    source,
                    prefix,
                    entry.Name,
                    entry.Length,
                    entry.ModificationTime.DateTime,
                    showHidden
                )
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
        showHidden bool
    ) {
        let normalized = Path.GetRelativePath(source, EntryPath(source, name))

        if normalized == "." {
            return
        }

        if !normalized.StartsWith(prefix, StringComparison.Ordinal) {
            return
        }

        let relative = normalized.Substring(prefix.Length)
        let slash = relative.IndexOf('/')
        let child = slash < 0 ? relative: relative.Substring(0, slash)

        if child == "" || (!showHidden && child.StartsWith('.')) || !names.Add(child) {
            return
        }

        snapshot.Entries.Add(
            FileEntry{
                Name: child,
                FullPath: Path.Combine(snapshot.DirectoryPath, child),
                IsDirectory: slash >= 0,
                Size: slash >= 0 ? 0: size,
                Modified: modified,
                Kind: slash >= 0 ? "Folder": Path.GetExtension(child).TrimStart('.'),
            }
        )
    }

    internal func Preview(path string) string {
        let source = Source(path)

        if source == "" || path == source {
            return path
        }

        lock gate {
            if !active.Contains(source) {
                throw OperationCanceledException()
            }

            if previews.TryGetValue(path, out var cached) {
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
                        Directory.Delete(Path.GetDirectoryName(preview.Value) ?? "", true)
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
                    let entry = archive.GetEntry(name) ?? throw IOException("Archive entry is unavailable: " + name)

                    if entry.Length > 16777216 {
                        throw IOException("Archive preview exceeds 16 MiB: " + name)
                    }

                    using let input = entry.Open()
                    using let output = FileStream(target, FileMode.CreateNew, FileAccess.Write)
                    input.CopyTo(output)
                } else {
                    using let input = File.OpenRead(source)
                    using let stream Stream = source.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
                    ? input: GZipStream(input, CompressionMode.Decompress, true)
                    using let reader = TarReader(stream, true)

                    while let entry = reader.GetNextEntry() {
                        if Path.GetRelativePath(source, EntryPath(source, entry.Name)) != name {
                            continue
                        }

                        if entry.Length > 16777216 || entry.DataStream == nil {
                            throw IOException("Archive entry cannot be previewed: " + name)
                        }

                        using let output = FileStream(target, FileMode.CreateNew, FileAccess.Write)
                        entry.DataStream?.CopyTo(output)
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
            } catch (failure Exception) when failure is IOException ||
                failure is UnauthorizedAccessException ||
                failure is OperationCanceledException {
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

    internal func Extract(source string, destination string) OperationResult {
        let staging = Path.Combine(Path.GetTempPath(), "gloop-extract-" + Guid.NewGuid().ToString("N"))

        try {
            Directory.CreateDirectory(staging)
            File.SetUnixFileMode(staging, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute)
            let archive = Source(source)
            let selected = source == archive ? "": Path.GetRelativePath(archive, source)
            Unpack(archive, staging, selected)

            if selected != "" {
                return FileOperationService().Copy(Path.Combine(staging, selected), destination)
            }
            let entries = Directory.GetFileSystemEntries(staging)
            let operations = FileOperationService()

            if entries.Length > 1 {
                FileNames.Validate(Stem(source))
                let container = Path.Combine(staging, Guid.NewGuid().ToString("N"))
                Directory.CreateDirectory(container)
                Directory.CreateDirectory(Path.Combine(container, Stem(source)))

                for entry in entries {
                    let result = operations.Move(entry, Path.Combine(container, Stem(source)))
                    if result.Error != "" {
                        throw IOException(result.Error)
                    }
                }

                return operations.Copy(Path.Combine(container, Stem(source)), destination)
            }

            if entries.Length == 0 {
                throw IOException("Archive is empty")
            }

            return operations.Copy(entries[0], destination)
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
                    Directory.Delete(Path.GetDirectoryName(preview.Value) ?? "", true)
                    expired.Add(preview.Key)
                }
            }

            for path in expired {
                previews.Remove(path)
            }
        }
    }

    internal func Close() {
        lock gate {
            active.Clear()

            for preview in previews.Values {
                Directory.Delete(Path.GetDirectoryName(preview) ?? "", true)
            }

            previews.Clear()
        }
    }
}
