package gloop

import System
import System.Collections.Generic
import System.ComponentModel
import System.IO
import System.IO.Enumeration
import System.Runtime.InteropServices
import System.Text

unsafe class PropertiesService {
    private let applications ApplicationService

    internal init(applications ApplicationService) {
        this.applications = applications
    }

    shared {
        private const MaxItems int32 = 2000000
    }

    /// Describes one path in full or several paths by count, common location, total size and contained items.
    /// Items excludes the selected paths. Symbolic links are never followed and count as an item of zero bytes.
    /// The optional early callback receives the cheap fields of a single path before the size walk starts.
    internal func Describe(
        paths List[string],
        cancelled Func[bool],
        early Action[FileProperties]? = nil
    ) FileProperties {
        var result = FileProperties{Count: paths.Count}

        try {
            if paths.Count == 0 {
                result.Error = "Read properties failed for selection: Nothing is selected"

                return result
            }

            if paths.Count == 1 {
                describe(normalize(paths[0]), ref result)

                if result.Error != "" {
                    return result
                }

                early?(result)
            }

            let tally = PropertiesTally()
            let location = Path.GetDirectoryName(normalize(paths[0])) ?? ""
            var common = true

            for path in paths {
                common = common && (Path.GetDirectoryName(normalize(path)) ?? "") == location
                measure(normalize(path), tally, cancelled)
            }

            result.Size = tally.Size
            result.Items = tally.Items
            result.Complete = tally.Complete
            result.Error = tally.Error
            result.Location = common ? location: ""
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is ArgumentException {
            result.Error = "Read properties failed for " + String.Join(", ", paths) + ": " + failure.Message
            result.Complete = false
        }

        return result
    }

    private func normalize(path string) string -> Path.TrimEndingDirectorySeparator(Path.GetFullPath(path))

    private func describe(path string, ref result FileProperties) {
        let raw *uint8 = stackalloc[FileSystemService.StatBufferSize]uint8
        let buffer = IntPtr(raw)
        let required = FileSystemService.StatType | FileSystemService.StatMode | FileSystemService.StatUid | FileSystemService.StatGid

        if FileSystemService.ReadStat(
            FileSystemService.AtCurrentDirectory,
            path,
            FileSystemService.AtSymlinkNoFollow,
            required | FileSystemService.StatBirthTime,
            buffer
        ) != 0 {
            result.Error = "Read properties failed for " + path + ": " + Win32Exception(
                Marshal.GetLastWin32Error()
            ).Message

            return
        }
        if (uint32(Marshal.ReadInt32(buffer, 0)) & required) != required {
            result.Error = "Cannot read properties for " + path + ": the filesystem did not report required metadata"
            return
        }

        result.Permissions = permissions(int32(Marshal.ReadInt16(buffer, 28)))
        result.Owner = identity("/etc/passwd", uint32(Marshal.ReadInt32(buffer, 20)))
        result.Group = identity("/etc/group", uint32(Marshal.ReadInt32(buffer, 24)))

        if (uint32(Marshal.ReadInt32(buffer, 0)) & FileSystemService.StatBirthTime) != 0 {
            result.Created = DateTimeOffset.FromUnixTimeSeconds(Marshal.ReadInt64(buffer, 80)).LocalDateTime
        }

        let info FileSystemInfo = Directory.Exists(path) ? DirectoryInfo(path): FileInfo(path)
        result.Name = info.Name
        result.LinkTarget = info.LinkTarget ?? ""
        result.MimeType = applications.MimeType(path)
        result.Modified = info.LastWriteTime
        result.Accessed = info.LastAccessTime
        result.Kind = FileKinds.EntryKind(Path.GetExtension(path), Directory.Exists(path), result.LinkTarget != "")
    }

    private func measure(path string, tally PropertiesTally, cancelled Func[bool]) {
        try {
            let info FileSystemInfo = Directory.Exists(path) ? DirectoryInfo(path): FileInfo(path)

            if info.LinkTarget != nil {
                return
            }

            if Directory.Exists(path) {
                walk(path, tally, cancelled)
            } else {
                tally.Size += FileInfo(path).Length
            }
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            tally.Complete = false

            if tally.Error == "" {
                tally.Error = "Measure failed for " + path + ": " + failure.Message
            }
        }
    }

    private func walk(root string, tally PropertiesTally, cancelled Func[bool]) {
        let options = EnumerationOptions()
        options.AttributesToSkip = FileAttributes(0)
        options.IgnoreInaccessible = false
        let pending = Stack[string]()
        pending.Push(root)

        while pending.Count > 0 {
            let directory = pending.Pop()

            try {
                for entry in FileSystemEnumerable[PropertiesEntry](
                    directory,
                    (ref raw FileSystemEntry) -> readEntry(ref raw),
                    options
                ) {
                    if cancelled() || tally.Items >= MaxItems {
                        tally.Complete = false

                        return
                    }

                    tally.Items++
                    tally.Size += entry.Size

                    if entry.Subfolder != "" {
                        pending.Push(entry.Subfolder)
                    }
                }
            } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
                tally.Complete = false

                if tally.Error == "" {
                    tally.Error = "Measure failed for " + directory + ": " + failure.Message
                }
            }
        }
    }

    private func readEntry(ref raw FileSystemEntry) PropertiesEntry {
        let link = raw.Attributes.HasFlag(FileAttributes.ReparsePoint)

        if link {
            return PropertiesEntry{}
        }
        if raw.IsDirectory {
            return PropertiesEntry{Subfolder: raw.ToFullPath()}
        }

        return PropertiesEntry{Size: raw.Length}
    }

    private func permissions(bits int32) string {
        let letters = "rwx"
        let text = StringBuilder()

        for index in 0 ... 9 {
            let granted = (bits & (256 >> index)) != 0
            var letter = granted ? letters[index % 3]: '-'

            if index % 3 == 2 && (bits & (2048 >> (index / 3))) != 0 {
                letter = index == 8 ? (granted ? 't': 'T'): (granted ? 's': 'S')
            }

            text.Append(letter)
        }

        return text.ToString() + " (" + Convert.ToString(bits & 4095, 8).PadLeft(3, '0') + ")"
    }

    private func identity(file string, id uint32) string {
        for line in Xdg.ReadLines(file) {
            let fields = line.Split(':')

            if fields.Length > 2 && fields[2] == id.ToString() {
                return fields[0]
            }
        }

        return id.ToString()
    }
}

class PropertiesTally {
    internal var Size int64
    internal var Items int32
    internal var Complete bool = true
    internal var Error string = ""
}

data struct PropertiesEntry {
    internal var Subfolder string = ""
    internal var Size int64
}
