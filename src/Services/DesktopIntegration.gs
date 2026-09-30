package gloop

import System
import System.IO
import System.Runtime.CompilerServices

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
            File.WriteAllText(
                desktop,
                "[Desktop Entry]\n" +
                    "Type=Application\n" +
                    "Name=Gloop\n" +
                    "Comment=Wayland file manager\n" +
                    "Exec=" +
                    QuotedExec(binary) +
                    " %f\n" +
                    "TryExec=" +
                    binary +
                    "\n" +
                    "Icon=" +
                    AppId +
                    "\n" +
                    "Terminal=false\n" +
                    "Categories=System;FileTools;FileManager;\n" +
                    "MimeType=inode/directory;\n"
            )
            return "Installed Gloop at " + binary + " and " + desktop
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
