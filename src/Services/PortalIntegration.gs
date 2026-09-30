package gloop

import System
import System.Collections.Generic
import System.IO

internal class PortalIntegration {
    shared {
        private const Interface string = "org.freedesktop.impl.portal.FileChooser"
        private const BusName string = "org.freedesktop.impl.portal.desktop.gloop"
        private const BackupSuffix string = ".gloop-chooser-backup"
        private const CreatedSuffix string = ".gloop-chooser-created"

        internal func Install() string {
            let systemBinary = DesktopIntegration.SystemBinary()
            if systemBinary != "" {
                RequireSystemBackend(systemBinary)
                return "Using the system-installed Gloop file chooser portal"
            }
            RequireUserBackendSupport()
            let dataHome = DesktopIntegration.UserDirectory("XDG_DATA_HOME", ".local/share")
            let binary = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".local/bin/gloop"
            )
            let service = Path.Combine(dataHome, "dbus-1/services", BusName + ".service")
            let portal = Path.Combine(dataHome, "xdg-desktop-portal/portals/gloop.portal")
            Directory.CreateDirectory(Path.GetDirectoryName(service) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(portal) ?? "")
            File.WriteAllText(
                service,
                "[D-BUS Service]\nName=" + BusName + "\nExec=" + DesktopIntegration.QuotedExec(binary, false) +
                    " --portal\n"
            )
            File.WriteAllText(portal, "[portal]\nDBusName=" + BusName + "\nInterfaces=" + Interface + ";\nUseIn=\n")
            return "Installed the Gloop file chooser portal. Select it with gloop --set-default-chooser."
        }

        internal func SetDefault() string {
            let systemBinary = DesktopIntegration.SystemBinary()
            if systemBinary != "" {
                RequireSystemBackend(systemBinary)
            } else {
                RequireUserBackendSupport()
            }
            let configHome = DesktopIntegration.UserDirectory("XDG_CONFIG_HOME", ".config")
            let names = ConfigNames()
            let target = ExistingConfig(configHome, names)
            let destination = target == "" ? Path.Combine(configHome, "xdg-desktop-portal", names[0]): target
            Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? "")
            let original = if target != "" {
                File.ReadAllText(target)
            } else {
                let source = InheritedConfig(names)
                source == "" ? "[preferred]\ndefault=*\n": File.ReadAllText(source)
            }
            if !File.Exists(destination + BackupSuffix) {
                File.WriteAllText(destination + BackupSuffix, original)
                if target == "" {
                    File.WriteAllText(destination + CreatedSuffix, "")
                }
            }
            File.WriteAllText(destination, Preference(original, "gloop"))
            return "Gloop is selected for portal file choosers. Restart xdg-desktop-portal to apply it. For Haruna, launch with PLASMA_INTEGRATION_USE_PORTAL=1."
        }

        internal func RestoreDefault() string {
            let configHome = DesktopIntegration.UserDirectory("XDG_CONFIG_HOME", ".config")
            for name in ConfigNames() {
                let destination = Path.Combine(configHome, "xdg-desktop-portal", name)
                let backup = destination + BackupSuffix
                if !File.Exists(backup) {
                    continue
                }
                let original = File.ReadAllText(backup)
                let current = File.Exists(destination) ? File.ReadAllText(destination): ""
                let restored = Preference(current, ReadPreference(original))
                if File.Exists(destination + CreatedSuffix) && Preference(current, "") == Preference(original, "") {
                    File.Delete(destination)
                } else {
                    File.WriteAllText(destination, restored)
                }
                File.Delete(backup)
                File.Delete(destination + CreatedSuffix)
                return "Restored the previous file chooser preference. Restart xdg-desktop-portal to apply it."
            }
            throw InvalidOperationException("No saved Gloop file chooser preference was found for this desktop")
        }

        private func ConfigNames() List[string] {
            let names = List[string]()
            for desktop in(Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").Split(':') {
                if desktop != "" && desktop.IndexOfAny("/\\".ToCharArray()) < 0 {
                    names.Add(desktop.ToLowerInvariant() + "-portals.conf")
                }
            }
            names.Add("portals.conf")
            return names
        }

        private func RequireUserBackendSupport() {
            for executable in[]string{
                "/usr/libexec/xdg-desktop-portal",
                "/usr/lib/xdg-desktop-portal",
                "xdg-desktop-portal"
            } {
                try {
                    let output = DesktopIntegration.RunTool(executable, []string{"--version"}, true).Trim()
                    let pieces = output.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    let version = Version.Parse(pieces[pieces.Length - 1])
                    if version >= Version(1, 20, 1) {
                        return
                    }
                } catch (failure Exception) { }
            }
            throw InvalidOperationException(
                "Chooser backends in user data or /usr/local/share require xdg-desktop-portal 1.20.1 or newer. Older desktops require a system package with its portal descriptor in /usr/share."
            )
        }

        private func RequireSystemBackend(binary string) {
            if binary == "/usr/local/bin/gloop" {
                RequireUserBackendSupport()
            }
            let dataRoot = DesktopIntegration.SystemData(binary)
            let service = Path.Combine(dataRoot, "dbus-1/services", BusName + ".service")
            let portal = Path.Combine(dataRoot, "xdg-desktop-portal/portals/gloop.portal")
            if !MatchesService(service, binary) || !MatchesPortal(portal) {
                throw InvalidOperationException(
                    "The system chooser registration does not match " +
                        binary +
                        ". Reinstall the Gloop package to restore " +
                        service +
                        " and " +
                        portal
                )
            }
            let dataHome = DesktopIntegration.UserDirectory("XDG_DATA_HOME", ".local/share")
            let userService = Path.Combine(dataHome, "dbus-1/services", BusName + ".service")
            let userPortal = Path.Combine(dataHome, "xdg-desktop-portal/portals/gloop.portal")
            for path in[]string{userService, userPortal} {
                if File.Exists(path) && (path == userService ? !MatchesService(path, binary): !MatchesPortal(path)) {
                    throw InvalidOperationException(
                        "A user chooser registration overrides the system package. Back up and remove " +
                            path +
                            ", then rerun " +
                            binary +
                            " with this option"
                    )
                }
            }
        }

        private func MatchesService(path string, binary string) bool ->
        DesktopIntegration.EntryValue(path, "D-BUS Service", "Name") == BusName && DesktopIntegration.EntryValue(
            path,
            "D-BUS Service",
            "Exec"
        ) == binary +
            " --portal"

        private func MatchesPortal(path string) bool ->
        DesktopIntegration.EntryValue(path, "portal", "DBusName") == BusName && Array.Exists(
            DesktopIntegration.EntryValue(path, "portal", "Interfaces").Split(';'),
            value -> value == Interface
        )

        private func ExistingConfig(root string, names List[string]) string {
            for name in names {
                let path = Path.Combine(root, "xdg-desktop-portal", name)
                if File.Exists(path) {
                    return path
                }
            }
            return ""
        }

        private func InheritedConfig(names List[string]) string {
            let roots = List[string]()
            for root in(Environment.GetEnvironmentVariable("XDG_CONFIG_DIRS") ?? "/etc/xdg").Split(':') {
                roots.Add(root)
            }
            roots.Add("/etc")
            roots.Add(DesktopIntegration.UserDirectory("XDG_DATA_HOME", ".local/share"))
            for root in(Environment.GetEnvironmentVariable("XDG_DATA_DIRS") ?? "/usr/local/share:/usr/share").Split(
                ':'
            ) {
                roots.Add(root)
            }
            roots.Add("/usr/share")
            for root in roots {
                if Path.IsPathFullyQualified(root) {
                    let config = ExistingConfig(root, names)
                    if config != "" {
                        return config
                    }
                }
            }
            return ""
        }

        private func ReadPreference(text string) string {
            var preferred = false
            var value = ""
            for line in text.Split('\n') {
                let trimmed = line.Trim()
                if trimmed.StartsWith("[") {
                    preferred = trimmed == "[preferred]"
                } else if preferred && IsPreference(trimmed) {
                    value = trimmed.Substring(trimmed.IndexOf('=') + 1).Trim()
                }
            }
            return value
        }

        private func IsPreference(line string) bool {
            let separator = line.IndexOf('=')
            return separator >= 0 && line.Substring(0, separator).Trim() == Interface
        }

        private func Preference(text string, value string) string {
            let lines = List[string]()
            var preferred = false
            var found = false
            for line in text.TrimEnd('\r', '\n').Split('\n') {
                let trimmed = line.Trim()
                if trimmed.StartsWith("[") {
                    preferred = trimmed == "[preferred]"
                    lines.Add(line)
                    if preferred && value != "" && !found {
                        lines.Add(Interface + "=" + value)
                        found = true
                    }
                } else if !preferred || !IsPreference(trimmed) {
                    lines.Add(line)
                }
            }
            if value != "" && !found {
                lines.Add("[preferred]")
                lines.Add(Interface + "=" + value)
            }
            return String.Join("\n", lines) + "\n"
        }
    }
}
