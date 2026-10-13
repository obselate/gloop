package gloop

import System
import System.Collections.Generic
import System.IO

class Xdg {
    shared {
        private const MaxFileSize int64 = 4194304

        internal func UserDirectory(variable string, fallback string, requireHome bool = false) string {
            let configured = Environment.GetEnvironmentVariable(variable) ?? ""

            if Path.IsPathFullyQualified(configured) {
                return configured
            }

            var home = Environment.GetEnvironmentVariable("HOME") ?? ""

            if !Path.IsPathFullyQualified(home) {
                if requireHome {
                    throw IOException("Home directory is unavailable")
                }

                home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            }

            return Path.Combine(home, fallback)
        }

        internal func ConfigHome() string -> UserDirectory("XDG_CONFIG_HOME", ".config")

        internal func WriteText(path string, text string) {
            let temporary = path + "." + Guid.NewGuid().ToString("N") + ".new"

            try {
                File.WriteAllText(temporary, text)
                File.Move(temporary, path, true)
            } finally {
                File.Delete(temporary)
            }
        }

        /// Returns the user data directory followed by the system data directories.
        internal func DataDirs() List[string] {
            let roots = directories("XDG_DATA_DIRS", "/usr/local/share:/usr/share")
            roots.Insert(0, UserDirectory("XDG_DATA_HOME", ".local/share"))

            return roots
        }

        /// Returns the user configuration directory followed by the system configuration directories.
        internal func ConfigDirs() List[string] {
            let roots = directories("XDG_CONFIG_DIRS", "/etc/xdg")
            roots.Insert(0, ConfigHome())

            return roots
        }

        /// Reads the lines of a text file. A missing, unreadable or oversized file yields no lines.
        internal func ReadLines(path string) List[string] {
            let lines = List[string]()

            try {
                if File.Exists(path) && FileInfo(path).Length <= MaxFileSize {
                    lines.AddRange(File.ReadLines(path))
                }
            } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException { }

            return lines
        }

        /// Parses an INI style file such as a desktop entry into groups of keys and values.
        internal func Groups(path string) Dictionary[string, Dictionary[string, string]] -> ParseGroups(ReadLines(path))

        internal func ParseGroups(lines IEnumerable[string]) Dictionary[string, Dictionary[string, string]] {
            let groups = Dictionary[string, Dictionary[string, string]]()
            var current = Dictionary[string, string]()

            for line in lines {
                let text = line.Trim()
                let separator = text.IndexOf('=')

                if text.StartsWith('[') && text.EndsWith(']') {
                    current = Dictionary[string, string]()
                    groups[text.Substring(1, text.Length - 2)] = current
                } else if separator > 0 && text[0] != '#' {
                    current[text.Substring(0, separator).Trim()] = text.Substring(separator + 1).Trim()
                }
            }

            return groups
        }

        internal func EntryValue(path string, section string, key string) string {
            let groups = Groups(path)

            return groups.TryGetValue(section, out var values) ? values.GetValueOrDefault(key, ""): ""
        }

        /// Resolves a program name through an absolute PATH entry. Returns an empty string when it is missing or not executable.
        internal func FindExecutable(name string) string {
            if name.Contains('/') {
                return isExecutable(name) ? name: ""
            }

            for directory in(Environment.GetEnvironmentVariable("PATH") ?? "").Split(
                ':',
                StringSplitOptions.RemoveEmptyEntries
            ) {
                if Path.IsPathFullyQualified(directory) && isExecutable(Path.Combine(directory, name)) {
                    return Path.Combine(directory, name)
                }
            }

            return ""
        }

        private func isExecutable(path string) bool {
            try {
                return File.Exists(path) && (int32(File.GetUnixFileMode(path)) & 73) != 0
            } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
                return false
            }
        }

        private func directories(variable string, fallback string) List[string] {
            let roots = List[string]()
            var value = Environment.GetEnvironmentVariable(variable) ?? ""

            if value == "" {
                value = fallback
            }

            for root in value.Split(':') {
                if Path.IsPathFullyQualified(root) && !roots.Contains(root) {
                    roots.Add(root)
                }
            }

            return roots
        }
    }
}
