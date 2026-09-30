package gloop

import System
import System.ComponentModel
import System.Globalization
import System.IO
import System.Runtime.InteropServices
import System.Text

class FileOperationService {
    shared {
        @DllImport("libc", EntryPoint: "renameat2", CharSet: CharSet.Ansi, SetLastError: true)
        private func renameNoReplace(
            sourceDirectory int32,
            source string,
            destinationDirectory int32,
            destination string,
            flags uint32
        ) int32;
    }

    internal func CreateFolder(directory string, name string) string {
        try {
            validateName(name)
            let parent = requireDirectory(directory)
            let destination = Path.Combine(parent, name)
            requireAbsent(destination)
            let staging = temporaryPath(destination)
            try {
                Directory.CreateDirectory(staging)
                moveEntry(staging, destination)
            } catch (failure Exception) {
                if !cleanup(staging) {
                    throw IOException(failure.Message + ". Partial folder remains at " + staging)
                }
                throw failure
            }
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    internal func Rename(source string, name string) string {
        try {
            validateName(name)
            let from = requireEntry(source)
            let parent = Path.GetDirectoryName(from) ?? ""
            let destination = Path.Combine(parent, name)
            if from == destination {
                return ""
            }
            requireAbsent(destination)
            moveEntry(from, destination)
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    internal func Copy(source string, destinationDirectory string) string {
        try {
            let from = requireEntry(source)
            let parent = requireDirectory(destinationDirectory)
            let destination = Path.Combine(parent, Path.GetFileName(from))
            validateDestination(from, parent, destination)
            let staging = temporaryPath(destination)
            try {
                copyEntry(from, staging)
                moveEntry(staging, destination)
            } catch (failure Exception) {
                if !cleanup(staging) {
                    throw IOException(failure.Message + ". Partial copy remains at " + staging)
                }
                throw failure
            }
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    internal func Move(source string, destinationDirectory string) string {
        try {
            let from = requireEntry(source)
            let parent = requireDirectory(destinationDirectory)
            let destination = Path.Combine(parent, Path.GetFileName(from))
            validateDestination(from, parent, destination)
            moveEntry(from, destination)
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    internal func Trash(source string) string {
        try {
            let from = requireEntry(source)
            let root = trashRoot()
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
            while exists(Path.Combine(files, name)) || exists(Path.Combine(info, name + ".trashinfo")) {
                index++
                name = trashName(leaf, index)
            }
            let dataPath = Path.Combine(files, name)
            let infoPath = Path.Combine(info, name + ".trashinfo")
            var metadataCreated bool
            try {
                writeTrashInfo(infoPath, from)
                metadataCreated = true
                moveEntry(from, dataPath)
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
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    private func validateName(name string) {
        if name == "" || name.Trim() == "" || name == "." || name == ".."
        || name.Contains("/") || name.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 {
            throw IOException("Enter a single valid name")
        }
    }

    private func requireDirectory(path string) string {
        let fullPath = Path.GetFullPath(path)
        if !Directory.Exists(fullPath) {
            throw IOException("Directory is unavailable: " + fullPath)
        }
        return fullPath
    }

    private func requireEntry(path string) string {
        let fullPath = Path.GetFullPath(path)
        let root = Path.GetPathRoot(fullPath) ?? ""
        if fullPath == root {
            throw IOException("The filesystem root cannot be changed")
        }
        File.GetAttributes(fullPath)
        return fullPath
    }

    private func requireAbsent(path string) {
        if exists(path) {
            throw IOException("An item already exists: " + path)
        }
    }

    private func validateDestination(source string, directory string, destination string) {
        if source == destination {
            throw IOException("Source and destination are the same")
        }
        requireAbsent(destination)
        let attributes = File.GetAttributes(source)
        if hasAttribute(attributes, FileAttributes.Directory) &&
            !hasAttribute(attributes, FileAttributes.ReparsePoint) {
            let physicalSource = physicalPath(source, 0)
            let physicalDestination = Path.Combine(physicalPath(directory, 0), Path.GetFileName(source))
            let relative = Path.GetRelativePath(physicalSource, physicalDestination)
            if relative == "." || (relative != ".." && !relative.StartsWith("../") && !Path.IsPathRooted(relative)) {
                throw IOException("Destination is inside the source folder")
            }
        }
    }

    private func physicalPath(path string, depth int32) string {
        if depth > 32 {
            throw IOException("Too many symbolic links in path")
        }
        let fullPath = Path.GetFullPath(path)
        var current = Path.GetPathRoot(fullPath) ?? "/"
        let relative = Path.GetRelativePath(current, fullPath)
        if relative == "." {
            return current
        }
        for segment in relative.Split(Path.DirectorySeparatorChar) {
            current = Path.Combine(current, segment)
            let target = DirectoryInfo(current).LinkTarget
            if target != nil {
                let parent = Path.GetDirectoryName(current) ?? "/"
                current = physicalPath(Path.IsPathRooted(target) ? target: Path.Combine(parent, target), depth + 1)
            }
        }
        return current
    }

    private func moveEntry(source string, destination string) {
        requireAbsent(destination)
        if OperatingSystem.IsLinux() {
            if renameNoReplace(-100, source, -100, destination, 1u) != 0 {
                let error = Marshal.GetLastWin32Error()
                if error == 18 {
                    throw IOException("Move across filesystems is unavailable")
                }
                throw IOException(Win32Exception(error).Message)
            }
            return
        }
        let attributes = File.GetAttributes(source)
        if hasAttribute(attributes, FileAttributes.Directory) {
            Directory.Move(source, destination)
        } else {
            File.Move(source, destination)
        }
    }

    private func copyEntry(source string, destination string) {
        requireAbsent(destination)
        let attributes = File.GetAttributes(source)
        let isDirectory = hasAttribute(attributes, FileAttributes.Directory)
        if hasAttribute(attributes, FileAttributes.ReparsePoint) {
            let target = isDirectory ? DirectoryInfo(source).LinkTarget: FileInfo(source).LinkTarget
            guard let linkTarget = target else {
                throw IOException("Symbolic link target is unavailable: " + source)
            }
            if isDirectory {
                Directory.CreateSymbolicLink(destination, linkTarget)
            } else {
                File.CreateSymbolicLink(destination, linkTarget)
            }
            return
        }
        if isDirectory {
            Directory.CreateDirectory(destination)
            for child in Directory.EnumerateFileSystemEntries(source) {
                copyEntry(child, Path.Combine(destination, Path.GetFileName(child)))
            }
            return
        }
        File.Copy(source, destination, false)
    }

    private func cleanup(path string) bool {
        try {
            if !exists(path) {
                return true
            }
            let attributes = File.GetAttributes(path)
            if hasAttribute(attributes, FileAttributes.ReparsePoint) {
                if hasAttribute(attributes, FileAttributes.Directory) {
                    Directory.Delete(path, false)
                } else {
                    File.Delete(path)
                }
            } else if hasAttribute(attributes, FileAttributes.Directory) {
                for child in Directory.EnumerateFileSystemEntries(path) {
                    if !cleanup(child) {
                        return false
                    }
                }
                Directory.Delete(path, false)
            } else {
                File.Delete(path)
            }
            return true
        } catch (failure Exception) {
            return false
        }
    }

    private func writeTrashInfo(path string, source string) {
        using let stream = FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)
        try {
            using let writer = StreamWriter(stream)
            writer.Write(
                "[Trash Info]\nPath=" + Uri.EscapeDataString(source).Replace("%2F", "/")
                + "\nDeletionDate=" + DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture) + "\n"
            )
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

    private func temporaryPath(destination string) string {
        let parent = Path.GetDirectoryName(destination) ?? ""
        return Path.Combine(parent, ".gloop-" + Guid.NewGuid().ToString("N"))
    }

    private func trashName(leaf string, index int32) string {
        let suffix = if index == 0 {
            ""
        } else {
            "." + index.ToString()
        }
        let maxBytes = 255 - Encoding.UTF8.GetByteCount(suffix + ".trashinfo")
        var length = leaf.Length
        while Encoding.UTF8.GetByteCount(leaf.Substring(0, length)) > maxBytes {
            length--
            if length > 0 && Char.IsHighSurrogate(leaf[length - 1]) {
                length--
            }
        }
        return leaf.Substring(0, length) + suffix
    }

    private func trashRoot() string {
        var dataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME") ?? ""
        if dataHome == "" || !Path.IsPathFullyQualified(dataHome) {
            let home = Environment.GetEnvironmentVariable("HOME") ?? ""
            if home == "" || !Path.IsPathFullyQualified(home) {
                throw IOException("Home directory is unavailable")
            }
            dataHome = Path.Combine(home, ".local", "share")
        }
        return Path.Combine(dataHome, "Trash")
    }

    private func rejectLink(path string) {
        if DirectoryInfo(path).LinkTarget != nil {
            throw IOException("Trash directory is a symbolic link: " + path)
        }
    }

    private func exists(path string) bool {
        try {
            File.GetAttributes(path)
            return true
        } catch (failure FileNotFoundException) {
            return false
        } catch (failure DirectoryNotFoundException) {
            return false
        }
    }

    private func hasAttribute(value FileAttributes, flag FileAttributes) bool -> (int32(value) & int32(flag)) != 0
}
