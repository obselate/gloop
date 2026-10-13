package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO

class ApplicationService {
    private const TextProbeBytes int32 = 8192

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
                return FileKinds.DirectoryMime
            }
            let known = database().Lookup(Path.GetFileName(fullPath))
            if known != "" {
                return known
            }
            return isText(fullPath) ? "text/plain": "application/octet-stream"
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            return "application/octet-stream"
        }
    }

    /// Lists the applications that can open a file, at most 24. The default comes first, then the other applications
    /// for the exact type, then those for its parent types such as text/plain.
    internal func Applications(path string) List[AppChoice] {
        let choices = List[AppChoice]()
        let types = database()
        let associations = associationDatabase()
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
        return choices
    }

    /// Starts an application on the given files in detached sessions without waiting. One process opens all files for
    /// %F and %U. One process per file opens them for %f and %u. Returns an empty string on success.
    internal func Launch(id string, paths List[string]) string {
        try {
            guard let app = find(id) else {
                return "Open With failed for " + String.Join(", ", paths) + ": Application not found: " + id
            }
            for command in plan(app, paths) {
                let error = start(command, app.WorkingDirectory)
                if error != "" {
                    return "Open With failed for " + String.Join(", ", paths) + ": " + error
                }
            }
            return ""
        } catch (failure Exception) when failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is System
            .ComponentModel
            .Win32Exception ||
            failure is InvalidOperationException {
            return "Open With failed for " + String.Join(", ", paths) + ": " + failure.Message
        }
    }

    private func database() MimeDatabase {
        lock gate {
            if let loaded = mime {
                return loaded
            }
            let files = List[MimeDataFile]()
            for root in Xdg.DataDirs() {
                files.Add(
                    MimeDataFile{
                        Globs: Xdg.ReadLines(Path.Combine(root, "mime", "globs2")),
                        Aliases: Xdg.ReadLines(Path.Combine(root, "mime", "aliases")),
                        Subclasses: Xdg.ReadLines(Path.Combine(root, "mime", "subclasses")),
                    }
                )
            }
            let created = MimeDatabase(files)
            mime = created
            return created
        }
    }

    private func associationDatabase() MimeAssociations {
        let names = List[string]()
        for desktop in(Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").Split(
            ':',
            StringSplitOptions.RemoveEmptyEntries
        ) {
            names.Add(desktop.ToLowerInvariant() + "-mimeapps.list")
        }
        names.Add("mimeapps.list")
        let roots = Xdg.DataDirs()
        let directories = Xdg.ConfigDirs()
        for root in roots {
            directories.Add(Path.Combine(root, "applications"))
        }
        let groups = List[Dictionary[string, Dictionary[string, string]]]()
        for directory in directories {
            for name in names {
                groups.Add(Xdg.Groups(Path.Combine(directory, name)))
            }
        }
        let caches = List[Dictionary[string, Dictionary[string, string]]]()
        for root in roots {
            caches.Add(Xdg.Groups(Path.Combine(root, "applications", "mimeinfo.cache")))
        }
        return MimeAssociations(groups, caches)
    }

    private func locales() List[string] {
        let keys = List[string]()
        let sources = List[string]((Environment.GetEnvironmentVariable("LANGUAGE") ?? "").Split(':'))
        for variable in[]string{"LC_ALL", "LC_MESSAGES", "LANG"} {
            let value = Environment.GetEnvironmentVariable(variable) ?? ""
            if value != "" {
                sources.Add(value)
                break
            }
        }
        for source in sources {
            let modifier = source.IndexOf('@') >= 0 ? source.Substring(source.IndexOf('@')): ""
            let locale = source.Split('@')[0].Split('.')[0]
            let language = locale.Split('_')[0]
            if language != "" && language != "C" && language != "POSIX" {
                keys.AddRange([]string{locale + modifier, locale, language + modifier, language})
            }
        }
        return keys
    }

    private func isText(path string) bool {
        if FileInfo(path).Length == 0 {
            return true
        }
        let buffer = [TextProbeBytes]uint8
        using let stream = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
        let count = stream.Read(buffer, 0, buffer.Length)
        return TextContent.IsText(buffer, count, count < buffer.Length)
    }

    private func find(id string) DesktopApp? {
        for root in Xdg.DataDirs() {
            let file = locate(Path.Combine(root, "applications"), id)
            if file != "" {
                return DesktopApp.Parse(
                    file,
                    Path.GetFileNameWithoutExtension(file),
                    Xdg.Groups(file),
                    (Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").Split(':'),
                    locales(),
                    name -> Xdg.FindExecutable(name)
                )
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
        let files = List[string]()
        for path in paths {
            files.Add(Path.GetFullPath(path))
        }
        let commands = app.Commands(files)
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
                wrapped.AddRange(TerminalService.CommandFlags(Path.GetFileName(candidate)))
                wrapped.AddRange(command)
                return wrapped
            }
        }
        throw InvalidOperationException("Could not find a desktop terminal")
    }
}
