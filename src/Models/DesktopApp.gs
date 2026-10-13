package gloop

import System
import System.Collections.Generic
import System.Text

class DesktopApp {
    internal let Source string
    internal let Name string
    internal let Icon string
    internal let WorkingDirectory string
    internal let Terminal bool
    private let tokens List[string]

    internal init(
        source string,
        name string,
        icon string,
        workingDirectory string,
        terminal bool,
        tokens List[string]
    ) {
        Source = source
        Name = name
        Icon = icon
        WorkingDirectory = workingDirectory
        Terminal = terminal
        this.tokens = tokens
    }

    shared {
        private const MaxFiles int32 = 128

        internal func Parse(
            source string,
            fallbackName string,
            groups Dictionary[string, Dictionary[string, string]],
            desktops[]string,
            locales List[string],
            findExecutable Func[string, string]
        ) DesktopApp? {
            if !groups.TryGetValue("Desktop Entry", out var entry) {
                return nil
            }

            let exec = unescape(get(entry, "Exec"))
            let listed = get(entry, "Hidden") != "true" && get(entry, "NoDisplay") != "true" && shown(entry, desktops)
            let tryExec = unescape(get(entry, "TryExec"))

            if get(entry, "Type") != "Application" || exec.Trim() == "" ||
                !listed ||
                (tryExec != "" && findExecutable(tryExec) == "") {
                return nil
            }

            let name = localizedName(entry, locales)

            return DesktopApp(
                source,
                name == "" ? fallbackName: name,
                unescape(get(entry, "Icon")),
                unescape(get(entry, "Path")),
                get(entry, "Terminal") == "true",
                tokenize(exec)
            )
        }

        private func get(entry Dictionary[string, string], key string) string -> entry.TryGetValue(
            key,
            out var value
        ) ? value: ""

        private func shown(entry Dictionary[string, string], current[]string) bool {
            let only = get(entry, "OnlyShowIn").Split(';', StringSplitOptions.RemoveEmptyEntries)
            let hidden = get(entry, "NotShowIn").Split(';', StringSplitOptions.RemoveEmptyEntries)
            let allowed = only.Length == 0 || Array.Exists(only, name -> Array.IndexOf(current, name) >= 0)

            return allowed && !Array.Exists(hidden, name -> Array.IndexOf(current, name) >= 0)
        }

        private func localizedName(entry Dictionary[string, string], locales List[string]) string {
            for locale in locales {
                if entry.TryGetValue("Name[" + locale + "]", out var name) {
                    return unescape(name)
                }
            }

            return unescape(get(entry, "Name"))
        }

        private func unescape(value string) string {
            let escapes = "snrt\\"
            let replacements = " \n\r\t\\"
            let text = StringBuilder()
            var index = 0

            while index < value.Length {
                let at = index + 1 < value.Length && value[index] == '\\' ? escapes.IndexOf(value[index + 1]): -1

                if at >= 0 {
                    text.Append(replacements[at])
                    index++
                } else {
                    text.Append(value[index])
                }

                index++
            }

            return text.ToString()
        }

        private func tokenize(exec string) List[string] {
            let tokens = List[string]()
            let current = StringBuilder()
            let text = exec + " "
            var started = false
            var quote = '\0'
            var index = 0

            while index < text.Length {
                let c = text[index]
                let next = index + 1 < text.Length ? text[index + 1]: ' '
                let escapable = quote == '"' && "\"`$\\".IndexOf(next) >= 0

                if c == '\\' && (quote == '\0' || escapable) {
                    current.Append(next)
                    started = true
                    index++
                } else if quote != '\0' {
                    if c == quote {
                        quote = '\0'
                    } else {
                        current.Append(c)
                    }
                } else if c == '"' || c == '\'' {
                    quote = c
                    started = true
                } else if c == ' ' || c == '\t' {
                    if started {
                        tokens.Add(current.ToString())
                        current.Clear()
                        started = false
                    }
                } else {
                    current.Append(c)
                    started = true
                }

                index++
            }

            return tokens
        }

        private func fileUri(path string) string {
            let text = StringBuilder("file://")

            for value in Encoding.UTF8.GetBytes(path) {
                let character = char(value)

                if Char.IsAsciiLetterOrDigit(character) || "-._~/".IndexOf(character) >= 0 {
                    text.Append(character)
                } else {
                    text.Append('%').Append(value.ToString("X2"))
                }
            }

            return text.ToString()
        }
    }

    /// Expands the Exec line into argument vectors, one per process. A %F or %U line opens all files in one
    /// process. A %f or %u line needs one process per file. Throws when the line cannot open the files.
    internal func Commands(paths List[string]) List[List[string]] {
        if paths.Count > MaxFiles {
            throw InvalidOperationException("Cannot open more than " + MaxFiles.ToString() + " files at once")
        }

        let multiple = uses("FU")

        if paths.Count > 0 && !multiple && !uses("fu") {
            throw InvalidOperationException(Name + " does not open files")
        }

        let files = paths
        let groups = List[List[string]]()

        if multiple || files.Count == 0 {
            groups.Add(files)
        } else {
            for file in files {
                groups.Add(List[string]{file})
            }
        }

        let commands = List[List[string]]()

        for group in groups {
            let command = arguments(group)

            if command.Count == 0 {
                throw InvalidOperationException(Name + " has no command to run")
            }

            commands.Add(command)
        }

        return commands
    }

    private func uses(codes string) bool {
        for token in tokens {
            var index = 0

            while index + 1 < token.Length {
                if token[index] == '%' {
                    if codes.IndexOf(token[index + 1]) >= 0 {
                        return true
                    }

                    index++
                }

                index++
            }
        }

        return false
    }

    private func arguments(files List[string]) List[string] {
        let argv = List[string]()

        for token in tokens {
            if token == "%F" {
                argv.AddRange(files)
            } else if token == "%U" {
                for file in files {
                    argv.Add(fileUri(file))
                }
            } else if token == "%i" {
                if Icon != "" {
                    argv.Add("--icon")
                    argv.Add(Icon)
                }
            } else {
                let text = substitute(token, files)

                if text != "" || !token.Contains('%') {
                    argv.Add(text)
                }
            }
        }

        return argv
    }

    private func substitute(token string, files List[string]) string {
        let text = StringBuilder()
        var index = 0

        while index < token.Length {
            if token[index] == '%' && index + 1 < token.Length {
                index++
                text.Append(
                    switch token[index] {
                        case '%': "%"
                        case 'f': files.Count > 0 ? files[0]: ""
                        case 'u': files.Count > 0 ? fileUri(files[0]): ""
                        case 'F': String.Join(" ", files)
                        case 'U': String.Join(" ", files.ConvertAll(file -> fileUri(file)))
                        case 'c': Name
                        case 'k': Source
                        default: ""
                    }
                )
            } else {
                text.Append(token[index])
            }

            index++
        }

        return text.ToString()
    }
}
