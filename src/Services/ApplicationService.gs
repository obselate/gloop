package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Text

class ApplicationService {
    private let gate object = Object()
    private var mime MimeDatabase?

    shared {
        private const MaxChoices int32 = 24
    }

    /// Returns the shared-mime-info type of a file or folder.
    internal func MimeType(path string) string {
        try {
            let fullPath = Path.GetFullPath(path)
            if Directory.Exists(fullPath) {
                return "inode/directory"
            }
            let known = database().Lookup(Path.GetFileName(fullPath))
            if known != "" {
                return known
            }
            return isText(fullPath) ? "text/plain": "application/octet-stream"
        } catch (failure Exception) {
            return "application/octet-stream"
        }
    }

    /// Lists the applications that can open a file, at most 24. The default comes first, then the other applications
    /// for the exact type, then those for its parent types such as text/plain.
    internal func Applications(path string) List[AppChoice] {
        let choices = List[AppChoice]()
        try {
            let types = database()
            let associations = MimeAssociations()
            let kind = MimeType(path)
            let chain = List[string]{kind}
            chain.AddRange(types.Ancestors(kind))
            let seen = HashSet[string]()
            for name in chain {
                for id in associations.Ids(types.Names(name)) {
                    if choices.Count < MaxChoices && seen.Add(id) {
                        if let app = find(id) {
                            choices.Add(AppChoice{Id: id, Name: app.Name, Default: choices.Count == 0})
                        }
                    }
                }
            }
        } catch (failure Exception) { }
        return choices
    }

    /// Starts an application on the given files in detached sessions without waiting. One process opens all files for
    /// %F and %U. One process per file opens them for %f and %u. Returns an empty string on success.
    internal func Launch(id string, paths List[string]) string {
        try {
            guard let app = find(id) else {
                return "Application not found: " + id
            }
            for command in plan(app, paths) {
                let error = start(command, app.WorkingDirectory)
                if error != "" {
                    return error
                }
            }
            return ""
        } catch (failure Exception) {
            return failure.Message
        }
    }

    private func database() MimeDatabase {
        lock gate {
            if let loaded = mime {
                return loaded
            }
            let created = MimeDatabase(Xdg.DataDirs())
            mime = created
            return created
        }
    }

    private func isText(path string) bool {
        if FileInfo(path).Length == 0 {
            return true
        }
        let buffer = [8192]uint8
        using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
        let count = stream.Read(buffer, 0, buffer.Length)
        for index in 0 ... count {
            if buffer[index] == 0 {
                return false
            }
        }
        try {
            UTF8Encoding(false, true).GetDecoder().GetCharCount(buffer, 0, count, count < buffer.Length)
            return true
        } catch (failure DecoderFallbackException) {
            return false
        }
    }

    private func find(id string) DesktopApp? {
        for root in Xdg.DataDirs() {
            let file = locate(Path.Combine(root, "applications"), id)
            if file != "" {
                return DesktopApp.Read(file)
            }
        }
        return nil
    }

    private func locate(directory string, id string) string {
        let direct = Path.Combine(directory, id)
        if File.Exists(direct) {
            return direct
        }
        var dash = id.IndexOf('-')
        while dash > 0 {
            let nested = Path.Combine(directory, id.Substring(0, dash))
            if Directory.Exists(nested) {
                let file = locate(nested, id.Substring(dash + 1))
                if file != "" {
                    return file
                }
            }
            dash = id.IndexOf('-', dash + 1)
        }
        return ""
    }

    private func plan(app DesktopApp, paths List[string]) List[List[string]] {
        let commands = app.Commands(paths)
        if app.Terminal {
            for index in 0 ... commands.Count {
                commands[index] = inTerminal(commands[index])
            }
        }
        return commands
    }

    private func start(command List[string], workingDirectory string) string {
        let program = Xdg.FindExecutable(command[0])
        if program == "" {
            return "Cannot find " + command[0]
        }
        let detach = Xdg.FindExecutable("setsid")
        let info = ProcessStartInfo(detach == "" ? program: detach)
        if detach != "" {
            info.ArgumentList.Add("-f")
            info.ArgumentList.Add(program)
        }
        for index in 1 ... command.Count {
            info.ArgumentList.Add(command[index])
        }
        info.UseShellExecute = false
        if Directory.Exists(workingDirectory) {
            info.WorkingDirectory = workingDirectory
        }
        using let process = Process.Start(info) ?? throw InvalidOperationException("Cannot start " + program)
        return ""
    }

    private func inTerminal(command List[string]) List[string] {
        for candidate in TerminalService.Candidates() {
            let program = Xdg.FindExecutable(candidate)
            if program != "" {
                let wrapped = List[string]{program}
                wrapped.AddRange(terminalFlags(Path.GetFileName(candidate)))
                wrapped.AddRange(command)
                return wrapped
            }
        }
        throw InvalidOperationException("Could not find a desktop terminal")
    }

    private func terminalFlags(name string)[]string {
        if name == "gnome-terminal" {
            return []string{"--"}
        }
        if name == "wezterm" {
            return []string{"start", "--"}
        }
        if name == "xfce4-terminal" {
            return []string{"-x"}
        }
        if name == "xdg-terminal-exec" || name == "foot" || name == "kitty" {
            return []string{}
        }
        return []string{"-e"}
    }
}
