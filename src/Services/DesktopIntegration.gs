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
            let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            let binary = Path.Combine(home, ".local", "bin", "gloop")
            let configuredDataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME") ?? ""
            let dataHome = if !String.IsNullOrEmpty(configuredDataHome) && Path.IsPathFullyQualified(
                configuredDataHome
            ) {
                configuredDataHome
            } else {
                Path.Combine(home, ".local", "share")
            }
            let icon = Path.Combine(dataHome, "icons", "hicolor", "512x512", "apps", AppId + ".png")
            let desktop = Path.Combine(dataHome, "applications", AppId + ".desktop")

            Directory.CreateDirectory(Path.GetDirectoryName(binary) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(icon) ?? "")
            Directory.CreateDirectory(Path.GetDirectoryName(desktop) ?? "")
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
            RunTool("xdg-mime", []string{"default", AppId + ".desktop", "inode/directory"}, true)
            let result = RunTool("xdg-mime", []string{"query", "default", "inode/directory"}, true)
            if result.Trim() != AppId + ".desktop" {
                throw InvalidOperationException("The desktop did not select Gloop as the default folder handler")
            }
            return "Gloop is the default application for opening folders. Save and extraction destination dialogs use the application's file chooser."
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

        private func RunTool(tool string, arguments[]string, required bool) string {
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

        private func QuotedExec(path string) string {
            let escaped = path
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("$", "\\$")
                .Replace("`", "\\`")
                .Replace("%", "%%")
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
