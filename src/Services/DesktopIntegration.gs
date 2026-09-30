package gloop

import System
import System.Diagnostics
import System.IO
import System.Runtime.CompilerServices
import System.Text

internal class DesktopIntegration {
    shared {
        private const AppId string = "io.github.obselate.gloop"

        internal func Install() string {
            if !OperatingSystem.IsLinux() || RuntimeFeature.IsDynamicCodeSupported {
                throw InvalidOperationException("Desktop installation requires a published Linux NativeAOT executable")
            }
            let source = Environment.ProcessPath
            ?? throw InvalidOperationException("Cannot locate the running executable")
            if SystemBinary() != "" {
                return "Using the system installation at " + source
            }
            let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            let binary = Path.Combine(home, ".local", "bin", "gloop")
            let dataHome = UserDirectory("XDG_DATA_HOME", ".local/share")
            let icon = Path.Combine(dataHome, "icons", "hicolor", "512x512", "apps", AppId + ".png")
            let desktop = Path.Combine(dataHome, "applications", AppId + ".desktop")
            let metainfo = Path.Combine(dataHome, "metainfo", AppId + ".metainfo.xml")

            Directory.CreateDirectory(Path.GetDirectoryName(binary) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(icon) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(desktop) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(metainfo) ?? "")
            if !String.Equals(Path.GetFullPath(source), Path.GetFullPath(binary), StringComparison.Ordinal) {
                let temporary = binary + ".new"
                File.Copy(source, temporary, true)
                File.SetUnixFileMode(
                    temporary,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite |
                    UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                    UnixFileMode.OtherRead | UnixFileMode.OtherExecute
                )
                File.Move(temporary, binary, true)
            }
            File.WriteAllBytes(icon, AppIcon.Bytes())
            let entry = DesktopEntry(binary)
            File.WriteAllText(desktop, entry)
            using let metadata = typeof(DesktopIntegration).Assembly.GetManifestResourceStream("gloop.Metainfo.xml")
            ?? throw InvalidOperationException("Embedded Gloop metadata is missing")
            using let reader = StreamReader(metadata)
            File.WriteAllText(metainfo, reader.ReadToEnd())
            let legacy = Path.Combine(dataHome, "applications", "gloop.desktop")
            if File.Exists(legacy) {
                let lines = File.ReadAllLines(legacy)
                let executable = "Exec=" + QuotedExec(binary)
                if Array.Exists(lines, line -> line == executable || line == executable + " %f") {
                    File.WriteAllText(legacy, entry + "NoDisplay=true\n")
                }
            }
            RefreshDesktop(dataHome)
            return "Installed Gloop at " + binary + " and " + desktop
        }

        internal func SetDefault() string {
            Directory.CreateDirectory(UserDirectory("XDG_CONFIG_HOME", ".config"))
            RunTool("xdg-mime", []string{"default", AppId + ".desktop", "inode/directory"}, true)
            let result = RunTool("xdg-mime", []string{"query", "default", "inode/directory"}, true)
            if result.Trim() != AppId + ".desktop" {
                throw InvalidOperationException("The desktop did not select Gloop as the default folder handler")
            }
            return "Gloop is the default application for opening folders. Save and extraction destination dialogs use the application's file chooser."
        }

        internal func UserDirectory(variable string, fallback string) string {
            let configured = Environment.GetEnvironmentVariable(variable) ?? ""
            return Path.IsPathFullyQualified(configured) ? configured:
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), fallback)
        }

        internal func SystemBinary() string {
            let binary = Environment.ProcessPath ?? ""
            if binary != "/usr/bin/gloop" && binary != "/usr/local/bin/gloop" {
                return ""
            }
            let desktop = Path.Combine(SystemData(binary), "applications", AppId + ".desktop")
            let expected = binary + " %f"
            if EntryValue(desktop, "Desktop Entry", "Type") != "Application" ||
                EntryValue(desktop, "Desktop Entry", "Exec") != expected {
                throw InvalidOperationException(
                    "The system launcher does not match " +
                        binary +
                        ". Reinstall the Gloop package to restore " +
                        desktop
                )
            }
            let userDesktop = Path.Combine(
                UserDirectory("XDG_DATA_HOME", ".local/share"),
                "applications",
                AppId + ".desktop"
            )
            if File.Exists(userDesktop) && EntryValue(userDesktop, "Desktop Entry", "Exec") != expected {
                throw InvalidOperationException(
                    "A user launcher overrides the system package. Back up and remove " +
                        userDesktop +
                        ", then rerun " +
                        binary +
                        " with this option"
                )
            }
            return binary
        }

        internal func SystemData(binary string) string -> binary == "/usr/bin/gloop" ? "/usr/share": "/usr/local/share"

        internal func EntryValue(path string, section string, key string) string {
            if !File.Exists(path) {
                return ""
            }
            var active = false
            var value = ""
            for line in File.ReadLines(path) {
                let trimmed = line.Trim()
                if trimmed.StartsWith('[') {
                    active = trimmed == "[" + section + "]"
                } else if active {
                    let separator = trimmed.IndexOf('=')
                    if separator >= 0 && trimmed.Substring(0, separator).Trim() == key {
                        value = trimmed.Substring(separator + 1).Trim()
                    }
                }
            }
            return value
        }

        private func DesktopEntry(binary string) string ->
        "[Desktop Entry]\n" +
            "Type=Application\n" +
            "Name=Gloop\n" +
            "GenericName=File Manager\n" +
            "Comment=Browse, preview, and manage files and folders\n" +
            "Keywords=files;folders;directory;browser;preview;Wayland;\n" +
            "Exec=" +
            QuotedExec(binary) +
            " %f\n" +
            "TryExec=" +
            DesktopValue(binary) +
            "\n" +
            "Icon=" +
            AppId +
            "\n" +
            "StartupWMClass=" +
            AppId +
            "\n" +
            "Terminal=false\n" +
            "Categories=System;FileTools;FileManager;\n" +
            "MimeType=inode/directory;\n"

        private func DesktopValue(value string) string -> value
            .Replace("\\", "\\\\")
            .Replace("\n", "\\n")
            .Replace("\r", "\\r")
            .Replace("\t", "\\t")

        private func RefreshDesktop(dataHome string) {
            RunTool("update-desktop-database", []string{Path.Combine(dataHome, "applications")}, false)
            RunTool(
                "gtk-update-icon-cache",
                []string{"--force", "--ignore-theme-index", Path.Combine(dataHome, "icons", "hicolor")},
                false
            )
            if (Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").Contains(
                "KDE",
                StringComparison.OrdinalIgnoreCase
            ) {
                RunTool("kbuildsycoca6", []string{"--noincremental"}, false)
                RunTool(
                    "dbus-send",
                    []string{
                        "--session",
                        "--type=signal",
                        "/KIconLoader",
                        "org.kde.KIconLoader.iconChanged",
                        "int32:4"
                    },
                    false
                )
            }
        }

        internal func RunTool(tool string, arguments[]string, required bool) string {
            try {
                let start = ProcessStartInfo(tool)
                start.UseShellExecute = false
                start.RedirectStandardOutput = required
                for argument in arguments {
                    start.ArgumentList.Add(argument)
                }
                using let process = Process.Start(start) ?? throw InvalidOperationException("Cannot start " + tool)
                let output = StringBuilder()
                scope {
                    if required {
                        go desktopReadOutput(process.StandardOutput, output)
                    }
                    if !process.WaitForExit(10000) {
                        process.Kill(true)
                        throw InvalidOperationException(tool + " timed out")
                    }
                }
                if process.ExitCode != 0 {
                    throw InvalidOperationException(tool + " exited with code " + process.ExitCode.ToString())
                }
                return output.ToString()
            } catch (failure Exception) {
                if required {
                    throw InvalidOperationException("Cannot set the default file manager: " + failure.Message)
                }
                return ""
            }
        }

        internal func QuotedExec(path string, fieldCodes bool = true) string {
            var escaped = path.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("$", "\\$").Replace("`", "\\`")
            if fieldCodes {
                escaped = escaped.Replace("%", "%%")
            }
            if path.IndexOfAny(" \t\n\r\"'\\><~|&;$*?#()`".ToCharArray()) < 0 {
                return escaped
            }
            return "\"" + escaped.Replace("\\", "\\\\") + "\""
        }
    }
}

func desktopReadOutput(reader StreamReader, output StringBuilder) {
    let buffer = [1024]char
    var count = reader.Read(buffer, 0, buffer.Length)
    while count > 0 {
        lock output {
            output.Append(buffer, 0, Math.Min(count, 4096 - output.Length))
        }
        count = reader.Read(buffer, 0, buffer.Length)
    }
}
