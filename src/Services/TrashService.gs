package gloop

import System
import System.IO

class TrashService {
    private let operations FileOperationService = FileOperationService()

    internal func FilesDirectory() string {
        try {
            return Path.GetFullPath(Path.Combine(operations.TrashRoot(), "files"))
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
            remove(source)
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
                    remove(entry)
                    File.Delete(infoFile(entry))
                } catch (failure Exception) {
                    result = result == "" ? failure.Message: result
                }
            }
            for orphan in entries(infoDirectory()) {
                try {
                    if Path.GetExtension(orphan) == ".trashinfo" && !operations.Exists(
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
            if DirectoryInfo(path).LinkTarget != nil {
                throw IOException("Trash directory is a symbolic link: " + path)
            }
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
        Path.GetFileName(source) + ".trashinfo"
    )

    private func entries(directory string)[]string -> Directory.Exists(directory)
    ? Directory.GetFileSystemEntries(directory): Array.Empty[string]()

    private func describe(source string) TrashItem {
        var item = TrashItem{TrashPath: source}
        try {
            let infoPath = infoFile(source)
            if FileInfo(infoPath).Length > 65536 {
                return item
            }
            var section = false
            for line in File.ReadLines(infoPath) {
                if line.StartsWith("[", StringComparison.Ordinal) {
                    section = line == "[Trash Info]"
                } else if section && line.StartsWith("Path=", StringComparison.Ordinal) {
                    let path = Uri.UnescapeDataString(line.Substring(5))
                    if Path.IsPathRooted(path) {
                        item.OriginalPath = Path.GetFullPath(path)
                    }
                }
            }
        } catch (failure Exception) { }
        return item
    }

    private func remove(path string) {
        let attributes = File.GetAttributes(path)
        if attributes.HasFlag(FileAttributes.Directory) && !attributes.HasFlag(FileAttributes.ReparsePoint) {
            for child in Directory.GetFileSystemEntries(path) {
                remove(child)
            }
            Directory.Delete(path, false)
        } else {
            File.Delete(path)
        }
    }
}
