package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text
import Tmds.DBus.Protocol

data struct MountEntry {
    internal var MountPath string = ""
    internal var Type string = ""
    internal var Source string = ""
    internal var Id string = ""
    internal var ReadOnly bool
}

class VolumeService {
    private const BusName string = "org.freedesktop.UDisks2"
    private const BlockInterface string = "org.freedesktop.UDisks2.Block"
    private const DriveInterface string = "org.freedesktop.UDisks2.Drive"
    private const FilesystemInterface string = "org.freedesktop.UDisks2.Filesystem"
    private const MaxVolumes int32 = 64
    private let Timeout TimeSpan = TimeSpan.FromSeconds(10)

    internal func List() List[Volume] {
        let volumes = System.Collections.Generic.List[Volume]()
        try {
            let mounts = readMounts()
            let seen = HashSet[string]()
            let names = HashSet[string]()
            let uuids = HashSet[string]()
            var root = Volume{Name: "File system", MountPath: "/"}
            for mount in mounts {
                if mount.MountPath == "/" {
                    seen.Add(mount.Id)
                    if isBlock(mount.Source) {
                        let name = blockName(mount.Source)
                        root.Device = mount.Source
                        names.Add(name)
                        uuids.Add(value(udevProperties(name), "ID_FS_UUID"))
                    }
                }
            }
            volumes.Add(withSpace(root, "/"))
            for mount in mounts {
                if volumes.Count >= MaxVolumes {
                    break
                }
                if mount.MountPath == "/" || !seen.Add(mount.Id) {
                    continue
                }
                if isBlock(mount.Source) {
                    let name = blockName(mount.Source)
                    if !isListed(name) || isSystemPath(mount.MountPath) {
                        continue
                    }
                    let properties = udevProperties(name)
                    names.Add(name)
                    uuids.Add(value(properties, "ID_FS_UUID"))
                    var volume = blockVolume(name, properties)
                    volume.MountPath = mount.MountPath
                    volume.Device = mount.Source
                    volume.Ejectable = true
                    volumes.Add(withSpace(volume, mount.MountPath))
                } else if isNetwork(mount.Type) {
                    volumes.Add(Volume{Name: mount.Source, MountPath: mount.MountPath, Device: mount.Source})
                } else if isUserFuse(mount) {
                    let name = Path.GetFileName(mount.MountPath)
                    volumes.Add(Volume{Name: name, MountPath: mount.MountPath, Device: mount.Source})
                }
            }
            let candidates = Directory.GetFileSystemEntries("/sys/class/block")
            Array.Sort(candidates, StringComparer.Ordinal)
            for candidate in candidates {
                let name = Path.GetFileName(candidate)
                if volumes.Count >= MaxVolumes {
                    break
                }
                if names.Contains(name) || !isListed(name) {
                    continue
                }
                let properties = udevProperties(name)
                let uuid = value(properties, "ID_FS_UUID")
                if value(properties, "ID_FS_USAGE") == "filesystem" &&
                    value(properties, "UDISKS_IGNORE") != "1" &&
                    (uuid == "" || !uuids.Contains(uuid)) {
                    var volume = blockVolume(name, properties)
                    volume.Device = "/dev/" + name
                    volumes.Add(volume)
                }
            }
        } catch (failure Exception) { }
        return volumes
    }

    internal func Space(path string) Volume {
        var volume = Volume{}
        try {
            let fullPath = Path.GetFullPath(path)
            for mount in readMounts() {
                if Locations.Contains(mount.MountPath, fullPath) && mount.MountPath.Length >= volume.MountPath.Length {
                    volume.MountPath = mount.MountPath
                    volume.Device = mount.Source
                }
            }
            return withSpace(volume, volume.MountPath != "" ? volume.MountPath: fullPath)
        } catch (failure Exception) {
            return volume
        }
    }

    internal func Mount(device string, out path string) string {
        var mounted = ""
        let failure = perform(
            device,
            (connection, block) -> {
                mounted = invoke(connection, block, FilesystemInterface, "Mount")
            }
        )
        path = mounted
        return failure
    }

    internal func Eject(volume Volume) string -> perform(
        volume.Device,
        (connection, block) -> {
            if volume.MountPath != "" {
                invoke(connection, block, FilesystemInterface, "Unmount")
            }
            if volume.Removable {
                let drive = property(connection, block, BlockInterface, "Drive").GetObjectPathAsString()
                if drive != "/" {
                    if property(connection, drive, DriveInterface, "Ejectable").GetBool() {
                        invoke(connection, drive, DriveInterface, "Eject")
                    } else if property(connection, drive, DriveInterface, "CanPowerOff").GetBool() {
                        invoke(connection, drive, DriveInterface, "PowerOff")
                    }
                }
            }
        }
    )

    private func perform(device string, work Action[DBusConnection, string]) string {
        let finished = chan[bool](1)
        let expired = chan[bool](1)
        try {
            let block = blockPath(device)
            using let connection = DBusConnection(DBusAddress.System ?? throw IOException("No system D-Bus address"))
            go expire(connection, finished, expired)
            connection.ConnectAsync().AsTask().GetAwaiter().GetResult()
            work(connection, block)
            return ""
        } catch (failure DBusErrorReplyException) {
            return failure.ErrorMessage != "" ? failure.ErrorMessage: failure.ErrorName
        } catch (failure Exception) {
            select {
                case <- expired {
                    return "Disk service did not answer within " + Timeout.TotalSeconds.ToString() + " s"
                }
                default {
                    return failure.Message
                }
            }
        } finally {
            finished.Close()
        }
    }

    private func expire(connection DBusConnection, finished chan[bool], expired chan[bool]) {
        select {
            case <- finished { }
            case <- after(Timeout) {
                expired.Close()
                connection.Dispose()
            }
        }
    }

    private func property(connection DBusConnection, path string, iface string, name string) VariantValue {
        using let writer = connection.GetMessageWriter()
        writer.WriteMethodCallHeader(BusName, path, "org.freedesktop.DBus.Properties", "Get", "ss")
        writer.WriteString(iface)
        writer.WriteString(name)
        let reply = connection.CallMethodAsync[VariantValue](
            writer.CreateMessage(),
            (message, _) -> message.GetBodyReader().ReadVariantValue(),
            nil
        )
        return reply.GetAwaiter().GetResult()
    }

    private func invoke(connection DBusConnection, path string, iface string, member string) string {
        using let writer = connection.GetMessageWriter()
        writer.WriteMethodCallHeader(BusName, path, iface, member, "a{sv}")
        writer.WriteDictionary(Dictionary[string, VariantValue]())
        let reply = connection.CallMethodAsync[string](
            writer.CreateMessage(),
            (message, _) -> message.SignatureAsString == "s" ? message.GetBodyReader().ReadString(): "",
            nil
        )
        return reply.GetAwaiter().GetResult()
    }

    private func blockPath(device string) string {
        if !device.StartsWith("/dev/", StringComparison.Ordinal) {
            throw IOException("Not a block device: " + device)
        }
        let path = StringBuilder("/org/freedesktop/UDisks2/block_devices/")
        for letter in blockName(device) {
            path.Append(Char.IsAsciiLetterOrDigit(letter) ? letter.ToString(): "_" + int32(letter).ToString("x2"))
        }
        return path.ToString()
    }

    private func blockName(device string) string -> Path.GetFileName(
        File.ResolveLinkTarget(device, true)?.FullName ?? device
    )

    private func isBlock(source string) bool -> source.StartsWith("/dev/", StringComparison.Ordinal)

    private func isListed(name string) bool {
        for prefix in[]string{"loop", "ram", "zram"} {
            if name.StartsWith(prefix, StringComparison.Ordinal) {
                return false
            }
        }
        return true
    }

    private func isSystemPath(path string) bool {
        for system in[]string{"/boot", "/efi"} {
            if Locations.Contains(system, path) {
                return true
            }
        }
        return false
    }

    private func isNetwork(type string) bool -> type == "cifs" || type == "smb3" || type == "nfs" || type == "nfs4"

    private func isUserFuse(mount MountEntry) bool -> mount.Type.StartsWith("fuse.", StringComparison.Ordinal) &&
        mount.Type != "fuse.portal" &&
        mount.Type != "fuse.gvfsd-fuse" &&
        !mount.ReadOnly

    private func value(values Dictionary[string, string], key string) string -> values.GetValueOrDefault(key, "")

    private func readMounts() List[MountEntry] {
        let mounts = System.Collections.Generic.List[MountEntry]()
        for line in File.ReadLines("/proc/self/mountinfo") {
            let split = line.IndexOf(" - ", StringComparison.Ordinal)
            if split < 0 {
                continue
            }
            let left = line.Substring(0, split).Split(' ')
            let right = line.Substring(split + 3).Split(' ')
            mounts.Add(
                MountEntry{
                    MountPath: unescape(left[4]),
                    Type: right[0],
                    Source: unescape(right[1]),
                    Id: left[2],
                    ReadOnly: ("," + left[5] + ",").Contains(",ro,"),
                }
            )
        }
        return mounts
    }

    private func unescape(value string) string -> value
        .Replace("\\040", " ")
        .Replace("\\011", "\t")
        .Replace("\\012", "\n")
        .Replace("\\134", "\\")

    private func udevProperties(name string) Dictionary[string, string] {
        let properties = Dictionary[string, string]()
        try {
            let id = File.ReadAllText("/sys/class/block/" + name + "/dev").Trim()
            for line in File.ReadLines("/run/udev/data/b" + id) {
                let split = line.IndexOf('=')
                if line.StartsWith("E:", StringComparison.Ordinal) && split > 2 {
                    properties[line.Substring(2, split - 2)] = line.Substring(split + 1)
                }
            }
        } catch (failure Exception) { }
        return properties
    }

    private func blockVolume(name string, properties Dictionary[string, string]) Volume {
        var label = ""
        var bytes int64
        try {
            bytes = Int64.Parse(File.ReadAllText("/sys/class/block/" + name + "/size").Trim()) * 512
            label = decode(value(properties, "ID_FS_LABEL_ENC"))
        } catch (failure Exception) { }
        let removable = value(properties, "ID_BUS") == "usb" || value(properties, "ID_INTEGRATION") == "external"
        return Volume{Name: label != "" ? label: sizeName(bytes), Removable: removable, Ejectable: removable}
    }

    private func decode(value string) string {
        let bytes = System.Collections.Generic.List[uint8]()
        var index = 0
        while index < value.Length {
            if value[index] == '\\' && index + 3 < value.Length && value[index + 1] == 'x' {
                bytes.Add(Convert.ToByte(value.Substring(index + 2, 2), 16))
                index += 4
            } else {
                bytes.AddRange(Encoding.UTF8.GetBytes(value[index].ToString()))
                index++
            }
        }
        return Encoding.UTF8.GetString(bytes.ToArray())
    }

    private func sizeName(bytes int64) string {
        if bytes >= 1048576 {
            return FileSystemService.FormatSize(bytes, true) + " volume"
        }
        return "Volume"
    }

    private func withSpace(volume Volume, path string) Volume {
        var result = volume
        try {
            let drive = DriveInfo(path)
            result.TotalBytes = drive.TotalSize
            result.FreeBytes = drive.AvailableFreeSpace
        } catch (failure Exception) { }
        return result
    }
}
