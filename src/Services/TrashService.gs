package gloop

import System
import System.IO
import System.Text

class TrashService {
    private const InfoByteLimit int64 = 65536

    private let operations FileOperationService = FileOperationService()

    internal func Trash(source string) OperationResult {
        try {
            let from = operations.RequireEntry(source)
            let root = TrashRoot()
            let files = Path.Combine(root, "files")
            let info = Path.Combine(root, "info")
            Directory.CreateDirectory(root)
            rejectLink(root)
            Directory.CreateDirectory(files)
            Directory.CreateDirectory(info)
            rejectLink(files)
            rejectLink(info)

            let leaf = Path.GetFileName(from)
            var index int32
            var name = trashName(leaf, index)
            while FileSystemService.Exists(Path.Combine(files, name)) || FileSystemService.Exists(
                Path.Combine(info, name + TrashInfo.Extension)
            ) {
                index++
                name = trashName(leaf, index)
            }
            let dataPath = Path.Combine(files, name)
            let infoPath = Path.Combine(info, name + TrashInfo.Extension)
            var metadataCreated bool
            try {
                writeTrashInfo(infoPath, from)
                metadataCreated = true
                operations.MoveEntry(from, dataPath)
            } catch (failure Exception) {
                if metadataCreated {
                    try {
                        File.Delete(infoPath)
                    } catch (cleanupFailure Exception) {
                        throw IOException(failure.Message + ". Trash metadata remains at " + infoPath)
                    }
                }
                throw failure
            }
            return OperationResult{Source: source, FinalPath: dataPath, Error: ""}
        } catch (failure Exception) {
            return OperationResult{Source: source, FinalPath: "", Error: failure.Message}
        }
    }

    internal func FilesDirectory() string {
        try {
            return Path.GetFullPath(Path.Combine(TrashRoot(), "files"))
        } catch (failure Exception) {
            return ""
        }
    }

    internal func Count() int32 {
        try {
            var count int32
            for entry in Directory.EnumerateFileSystemEntries(requireStore()) {
                count++
            }
            return count
        } catch (failure Exception) {
            return 0
        }
    }

    internal func Restore(trashPath string) OperationResult {
        var finalPath = ""
        try {
            let source = locate(trashPath)
            let target = describe(source).OriginalPath
            if target == "" {
                throw IOException("Original location is unknown")
            }
            operations.RequireAbsent(target)
            Directory.CreateDirectory(Path.GetDirectoryName(target) ?? "/")
            operations.MoveEntry(source, target)
            finalPath = target
            try {
                File.Delete(infoFile(source))
            } catch (failure Exception) {
                throw IOException("Restored " + target + ". Trash metadata remains: " + failure.Message)
            }
            return OperationResult{Source: trashPath, FinalPath: finalPath, Error: ""}
        } catch (failure Exception) {
            return OperationResult{Source: trashPath, FinalPath: finalPath, Error: failure.Message}
        }
    }

    internal func Delete(trashPath string) OperationResult {
        try {
            let source = locate(trashPath)
            FileSystemService.Remove(source)
            File.Delete(infoFile(source))
            return OperationResult{Source: trashPath, FinalPath: "", Error: ""}
        } catch (failure Exception) {
            return OperationResult{Source: trashPath, FinalPath: "", Error: failure.Message}
        }
    }

    internal func Empty() OperationResult {
        var result = ""
        try {
            let files = requireStore()
            for entry in entries(files) {
                try {
                    FileSystemService.Remove(entry)
                    File.Delete(infoFile(entry))
                } catch (failure Exception) {
                    result = result == "" ? failure.Message: result
                }
            }
            for orphan in entries(infoDirectory()) {
                try {
                    if Path.GetExtension(orphan) == TrashInfo.Extension && !FileSystemService.Exists(
                        Path.Combine(files, Path.GetFileNameWithoutExtension(orphan))
                    ) {
                        File.Delete(orphan)
                    }
                } catch (failure Exception) {
                    result = result == "" ? failure.Message: result
                }
            }
        } catch (failure Exception) {
            return OperationResult{Source: FilesDirectory(), FinalPath: "", Error: failure.Message}
        }
        return OperationResult{Source: FilesDirectory(), FinalPath: "", Error: result}
    }

    private func requireStore() string {
        let files = FilesDirectory()
        if files == "" {
            throw IOException("Home directory is unavailable")
        }
        for path in[]string{Path.GetDirectoryName(files) ?? "", files, infoDirectory()} {
            rejectLink(path)
        }
        return files
    }

    private func locate(trashPath string) string {
        let files = requireStore()
        let fullPath = Path.GetFullPath(trashPath)
        if Path.GetDirectoryName(fullPath) != files || Path.GetFileName(fullPath) == "" {
            throw IOException("Not an item in Trash: " + trashPath)
        }
        return fullPath
    }

    private func infoDirectory() string -> Path.Combine(Path.GetDirectoryName(FilesDirectory()) ?? "", "info")

    private func infoFile(source string) string -> Path.Combine(
        infoDirectory(),
        Path.GetFileName(source) + TrashInfo.Extension
    )

    private func entries(directory string)[]string -> Directory.Exists(directory)
    ? Directory.GetFileSystemEntries(directory): Array.Empty[string]()

    private func describe(source string) TrashItem {
        var item = TrashItem{TrashPath: source}
        try {
            let infoPath = infoFile(source)
            if FileInfo(infoPath).Length > InfoByteLimit {
                return item
            }
            item = TrashInfo.Parse(source, File.ReadLines(infoPath))
        } catch (failure Exception) { }
        return item
    }

    private func writeTrashInfo(path string, source string) {
        using let stream = FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)
        try {
            using let writer = StreamWriter(stream)
            writer.Write(TrashInfo.Format(source, DateTime.Now))
        } catch (failure Exception) {
            stream.Dispose()
            try {
                File.Delete(path)
            } catch (cleanupFailure Exception) {
                throw IOException(failure.Message + ". Trash metadata remains at " + path)
            }
            throw failure
        }
    }

    private func trashName(leaf string, index int32) string {
        let suffix = if index == 0 {
            ""
        } else {
            "." + index.ToString()
        }
        let maxBytes = FileNames.MaxBytes - Encoding.UTF8.GetByteCount(suffix + TrashInfo.Extension)
        return FileNames.Truncate(leaf, maxBytes) + suffix
    }

    private func rejectLink(path string) {
        if DirectoryInfo(path).LinkTarget != nil {
            throw IOException("Trash directory is a symbolic link: " + path)
        }
    }

    internal func TrashRoot() string -> Path.Combine(Xdg.UserDirectory("XDG_DATA_HOME", ".local/share", true), "Trash")
}
