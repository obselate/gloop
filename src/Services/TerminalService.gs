package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO

class TerminalService {
    private const StartupCheckMilliseconds int32 = 200

    internal func Open(directory string) string {
        try {
            let path = Path.GetFullPath(directory)

            if !Directory.Exists(path) {
                return "Open terminal failed for " + directory + ": Folder does not exist"
            }

            var lastError = ""

            for candidate in Candidates() {
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
                        let exited = launched.WaitForExit(StartupCheckMilliseconds)
                        let code = exited ? launched.ExitCode: 0
                        launched.Dispose()

                        if !exited || code == 0 {
                            return ""
                        }

                        lastError = candidate + " exited with code " + code.ToString()
                    } else {
                        lastError = candidate + " did not start"
                    }
                } catch (failure Exception) when failure is System
                    .ComponentModel
                    .Win32Exception ||
                    failure is InvalidOperationException ||
                    failure is IOException ||
                    failure is UnauthorizedAccessException {
                    lastError = candidate + ": " + failure.Message
                }
            }

            return "Open terminal failed for " + directory + ": Could not find a desktop terminal. " + lastError
        } catch (failure ArgumentException) {
            return "Open terminal failed for " + directory + ": " + failure.Message
        }
    }

    shared {
        internal func CommandFlags(name string)[]string -> switch name {
            case "gnome-terminal": []string{"--"}
            case "wezterm": []string{"start", "--"}
            case "xfce4-terminal": []string{"-x"}
            case "xdg-terminal-exec" or "foot" or "kitty": []string{}
            default: []string{"-e"}
        }

        internal func Candidates() List[string] {
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

            return candidates
        }
    }
}
