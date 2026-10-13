package gloop

import System
import System.Diagnostics
import System.IO
import System.Runtime.CompilerServices
import System.Text

internal class DesktopIntegration {
    private const ToolTimeoutMilliseconds int32 = 10000
    internal const OutputBufferCharacters int32 = 1024
    internal const OutputCharacterLimit int32 = 4096

    shared {
        internal const AppId string = "io.github.obselate.gloop"
        internal const SystemBinaryPath string = "/usr/bin/gloop"
        internal const LocalSystemBinaryPath string = "/usr/local/bin/gloop"

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
            let dataHome = Xdg.UserDirectory("XDG_DATA_HOME", ".local/share")
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
            Xdg.WriteText(desktop, entry)
            using let metadata = typeof(DesktopIntegration).Assembly.GetManifestResourceStream("gloop.Metainfo.xml")
            ?? throw InvalidOperationException("Embedded Gloop metadata is missing")
            using let reader = StreamReader(metadata)
            Xdg.WriteText(metainfo, reader.ReadToEnd())
            let legacy = Path.Combine(dataHome, "applications", "gloop.desktop")
            if File.Exists(legacy) {
                let lines = File.ReadAllLines(legacy)
                let executable = "Exec=" + QuotedExec(binary)
                if Array.Exists(lines, line -> line == executable || line == executable + " %f") {
                    Xdg.WriteText(legacy, entry + "NoDisplay=true\n")
                }
            }
            RefreshDesktop(dataHome)
            return "Installed Gloop at " + binary + " and " + desktop
        }

        internal func SetDefault() string {
            Directory.CreateDirectory(Xdg.ConfigHome())
            RunTool("xdg-mime", []string{"default", AppId + ".desktop", FileKinds.DirectoryMime}, true)
            let result = RunTool("xdg-mime", []string{"query", "default", FileKinds.DirectoryMime}, true)
            if result.Trim() != AppId + ".desktop" {
                throw InvalidOperationException("The desktop did not select Gloop as the default folder handler")
            }
            return "Gloop is the default application for opening folders. Save and extraction destination dialogs use the application's file chooser."
        }

        internal func SystemBinary() string {
            let binary = Environment.ProcessPath ?? ""
            if binary != SystemBinaryPath && binary != LocalSystemBinaryPath {
                return ""
            }
            let desktop = Path.Combine(SystemData(binary), "applications", AppId + ".desktop")
            let expected = binary + " %f"
            if Xdg.EntryValue(desktop, "Desktop Entry", "Type") != "Application" || Xdg.EntryValue(
                desktop,
                "Desktop Entry",
                "Exec"
            ) != expected {
                throw InvalidOperationException(
                    "The system launcher does not match " +
                        binary +
                        ". Reinstall the Gloop package to restore " +
                        desktop
                )
            }
            let userDesktop = Path.Combine(
                Xdg.UserDirectory("XDG_DATA_HOME", ".local/share"),
                "applications",
                AppId + ".desktop"
            )
            if File.Exists(userDesktop) && Xdg.EntryValue(userDesktop, "Desktop Entry", "Exec") != expected {
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

        internal func SystemData(binary string) string -> binary == SystemBinaryPath ? "/usr/share": "/usr/local/share"

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
            "MimeType=" +
            FileKinds.DirectoryMime +
            ";\n"

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
                    if !process.WaitForExit(ToolTimeoutMilliseconds) {
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
    let buffer = [DesktopIntegration.OutputBufferCharacters]char
    var count = reader.Read(buffer, 0, buffer.Length)
    while count > 0 {
        lock output {
            output.Append(buffer, 0, Math.Min(count, DesktopIntegration.OutputCharacterLimit - output.Length))
        }
        count = reader.Read(buffer, 0, buffer.Length)
    }
}
