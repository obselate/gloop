package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO

class TerminalService {
    internal func Open(directory string) string {
        try {
            let path = Path.GetFullPath(directory)
            if !Directory.Exists(path) {
                return "Folder does not exist: " + path
            }
            let candidates = List[string]()
            let preferred = Environment.GetEnvironmentVariable("TERMINAL") ?? ""
            if preferred != "" && !preferred.Contains(" ") && !preferred.Contains("\t") {
                candidates.Add(preferred)
            }
            let names = "xdg-terminal-exec,ghostty,konsole,foot,alacritty,kitty,wezterm,gnome-terminal,xfce4-terminal,xterm"
            for name in names.Split(',') {
                if !candidates.Contains(name) {
                    candidates.Add(name)
                }
            }
            for candidate in candidates {
                try {
                    let start = ProcessStartInfo(candidate)
                    start.WorkingDirectory = path
                    start.UseShellExecute = false
                    let name = Path.GetFileName(candidate)
                    if name == "xdg-terminal-exec" {
                        start.ArgumentList.Add("--dir=" + path)
                    } else if name == "ghostty" {
                        start.ArgumentList.Add("--working-directory=" + path)
                        start.ArgumentList.Add("--window-inherit-working-directory=false")
                        start.ArgumentList.Add("--gtk-single-instance=false")
                    } else if name == "konsole" {
                        start.ArgumentList.Add("--workdir")
                        start.ArgumentList.Add(path)
                    } else if name == "foot" || name == "gnome-terminal" || name == "xfce4-terminal" {
                        start.ArgumentList.Add("--working-directory=" + path)
                    } else if name == "alacritty" {
                        start.ArgumentList.Add("--working-directory")
                        start.ArgumentList.Add(path)
                    } else if name == "kitty" {
                        start.ArgumentList.Add("--directory")
                        start.ArgumentList.Add(path)
                    } else if name == "wezterm" {
                        start.ArgumentList.Add("start")
                        start.ArgumentList.Add("--cwd")
                        start.ArgumentList.Add(path)
                    }
                    let process = Process.Start(start)
                    if let launched = process {
                        let failed = launched.WaitForExit(200) && launched.ExitCode != 0
                        launched.Dispose()
                        if !failed {
                            return ""
                        }
                    }
                } catch (failure Exception) { }
            }
            return "Could not find a desktop terminal"
        } catch (failure Exception) {
            return failure.Message
        }
    }
}
