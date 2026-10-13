package gloop

import System
import System.ComponentModel
import System.IO
import System.Runtime.InteropServices

unsafe class FileOperationService {
    private const SymlinkDepthLimit int32 = 32

    shared {
        private const RenameNoReplace uint32 = 1u
        private const CrossDeviceError int32 = 18
        private const InvalidArgumentError int32 = 22

        @DllImport("libc", EntryPoint: "renameat2", CharSet: CharSet.Ansi, SetLastError: true)
        private func renameNoReplace(
            sourceDirectory int32,
            source string,
            destinationDirectory int32,
            destination string,
            flags uint32
        ) int32;
    }

    internal func CreateFolder(directory string, name string) OperationResult {
        try {
            FileNames.Validate(name)
            let parent = requireDirectory(directory)
            let destination = Path.Combine(parent, name)
            RequireAbsent(destination)
            let staging = temporaryPath(destination)
            try {
                Directory.CreateDirectory(staging)
                MoveEntry(staging, destination)
            } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
                if !cleanup(staging) {
                    throw IOException(failure.Message + ". Partial folder remains at " + staging)
                }
                rethrow
            }
            return OperationResult{Source: directory, FinalPath: destination, Error: ""}
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            return OperationResult{Source: name, FinalPath: "", Error: failure.Message}
        }
    }

    internal func Rename(source string, name string) OperationResult {
        try {
            FileNames.Validate(name)
            let from = RequireEntry(source)
            let parent = Path.GetDirectoryName(from) ?? ""
            let destination = Path.Combine(parent, name)
            if from == destination {
                return OperationResult{Source: source, FinalPath: destination, Error: ""}
            }
            RequireAbsent(destination)
            MoveEntry(from, destination)
            return OperationResult{Source: source, FinalPath: destination, Error: ""}
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            return OperationResult{Source: source, FinalPath: "", Error: failure.Message}
        }
    }

    internal func Copy(source string, destinationDirectory string) OperationResult {
        try {
            let from = RequireEntry(source)
            let parent = requireDirectory(destinationDirectory)
            let destination = Path.Combine(parent, Path.GetFileName(from))
            validateDestination(from, parent, destination)
            let staging = temporaryPath(destination)
            try {
                copyEntry(from, staging)
                MoveEntry(staging, destination)
            } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
                if !cleanup(staging) {
                    throw IOException(failure.Message + ". Partial copy remains at " + staging)
                }
                rethrow
            }
            return OperationResult{Source: source, FinalPath: destination, Error: ""}
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            return OperationResult{Source: source, FinalPath: "", Error: failure.Message}
        }
    }

    internal func Move(source string, destinationDirectory string) OperationResult {
        try {
            let from = RequireEntry(source)
            let parent = requireDirectory(destinationDirectory)
            let destination = Path.Combine(parent, Path.GetFileName(from))
            validateDestination(from, parent, destination)
            MoveEntry(from, destination)
            return OperationResult{Source: source, FinalPath: destination, Error: ""}
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            return OperationResult{Source: source, FinalPath: "", Error: failure.Message}
        }
    }

    private func requireDirectory(path string) string {
        let fullPath = Path.GetFullPath(path)
        if !Directory.Exists(fullPath) {
            throw IOException("Directory is unavailable: " + fullPath)
        }
        return fullPath
    }

    internal func RequireEntry(path string) string {
        let fullPath = Path.GetFullPath(path)
        let root = Path.GetPathRoot(fullPath) ?? ""
        if fullPath == root {
            throw IOException("The filesystem root cannot be changed")
        }
        File.GetAttributes(fullPath)
        return fullPath
    }

    internal func RequireAbsent(path string) {
        if FileSystemService.Exists(path) {
            throw IOException("An item already exists: " + path)
        }
    }

    private func validateDestination(source string, directory string, destination string) {
        if source == destination {
            throw IOException("Source and destination are the same")
        }
        RequireAbsent(destination)
        let attributes = File.GetAttributes(source)
        if attributes.HasFlag(FileAttributes.Directory) && !attributes.HasFlag(FileAttributes.ReparsePoint) {
            let physicalSource = physicalPath(source, 0)
            let physicalDestination = Path.Combine(physicalPath(directory, 0), Path.GetFileName(source))
            if Locations.Contains(physicalSource, physicalDestination) {
                throw IOException("Destination is inside the source folder")
            }
        }
    }

    private func physicalPath(path string, depth int32) string {
        if depth > SymlinkDepthLimit {
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

    internal func MoveEntry(source string, destination string) {
        RequireAbsent(destination)
        if OperatingSystem.IsLinux() {
            if renameNoReplace(
                FileSystemService.AtCurrentDirectory,
                source,
                FileSystemService.AtCurrentDirectory,
                destination,
                RenameNoReplace
            ) != 0 {
                let error = Marshal.GetLastWin32Error()
                if error == CrossDeviceError {
                    throw IOException("Move across filesystems is unavailable")
                }
                if error == InvalidArgumentError {
                    throw IOException(
                        "Cannot rename " + source + ": the filesystem does not support a safe no-replace rename"
                    )
                }
                throw IOException(Win32Exception(error).Message)
            }
            return
        }
        let attributes = File.GetAttributes(source)
        if attributes.HasFlag(FileAttributes.Directory) {
            Directory.Move(source, destination)
        } else {
            File.Move(source, destination)
        }
    }

    private func copyEntry(source string, destination string) {
        RequireAbsent(destination)
        let attributes = File.GetAttributes(source)
        let isDirectory = attributes.HasFlag(FileAttributes.Directory)
        if attributes.HasFlag(FileAttributes.ReparsePoint) {
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
        if OperatingSystem.IsLinux() {
            let buffer *uint8 = stackalloc[FileSystemService.StatBufferSize]uint8
            let pointer = IntPtr(buffer)
            if FileSystemService.ReadStat(
                FileSystemService.AtCurrentDirectory,
                source,
                FileSystemService.AtSymlinkNoFollow,
                FileSystemService.StatType,
                pointer
            ) != 0 {
                throw IOException("Cannot copy " + source + ": " + Win32Exception(Marshal.GetLastWin32Error()).Message)
            }
            if (uint32(Marshal.ReadInt32(pointer, 0)) & FileSystemService.StatType) == 0 {
                throw IOException("Cannot copy " + source + ": the filesystem did not report the file type")
            }
            if (
                int32(Marshal.ReadInt16(pointer, 28)) & FileSystemService.FileTypeMask
            ) != FileSystemService.RegularFileType {
                throw IOException("Cannot copy non-regular file: " + source)
            }
        }
        File.Copy(source, destination, false)
    }

    private func cleanup(path string) bool {
        try {
            if FileSystemService.Exists(path) {
                FileSystemService.Remove(path)
            }
            return true
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            return false
        }
    }

    private func temporaryPath(destination string) string {
        let parent = Path.GetDirectoryName(destination) ?? ""
        return Path.Combine(parent, ".gloop-" + Guid.NewGuid().ToString("N"))
    }
}
