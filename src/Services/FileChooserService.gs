package gloop

import System
import System.Collections.Generic
import System.ComponentModel
import System.IO
import System.Runtime.InteropServices
import System.Text

data struct ChooserValidation {
    internal var Result PortalChooserResult?
    internal var Error string = ""
    internal var ReplacePaths List[string] = List[string]()
}

data struct ChooserPattern {
    internal var Value string
    internal var Flags int32
}

class FileChooserService {
    internal let Request PortalChooserRequest
    internal let Saving bool
    internal let SavingMany bool
    internal let InitialDirectory string
    internal let InitialSelectedPath string
    internal let InitialName string

    internal init(request PortalChooserRequest) {
        Request = request
        Saving = request.Method == "SaveFile"
        SavingMany = request.Method == "SaveFiles"
        var folder = request.CurrentFolder
        var selected = ""
        var name = request.CurrentName
        if Saving && Path.IsPathFullyQualified(request.CurrentFile) {
            selected = Path.GetFullPath(request.CurrentFile)
            folder = Path.GetDirectoryName(selected) ?? folder
            if name == "" {
                name = Path.GetFileName(request.CurrentFile)
            }
        }
        if !accessibleDirectory(folder) {
            folder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        }
        if !accessibleDirectory(folder) {
            folder = Environment.CurrentDirectory
        }
        InitialDirectory = Path.GetFullPath(folder)
        InitialSelectedPath = Path.GetDirectoryName(selected) == InitialDirectory ? selected: ""
        InitialName = name
    }

    internal func CreateEntryFilter(filter PortalFilter?) Func[FileEntry, bool] {
        let directoriesOnly = (Request.Method == "OpenFile" && Request.Directory) || SavingMany
        let patterns = List[ChooserPattern]()
        let mimes = List[string]()
        let accepted = HashSet[string](StringComparer.Ordinal)
        if let active = filter {
            for pattern in active.Patterns {
                if pattern.Type == 0 {
                    patterns.Add(ChooserPattern{Value: pattern.Value, Flags: 0})
                } else if pattern.Type == 1 {
                    mimes.Add(pattern.Value)
                }
            }
        }
        if mimes.Count > 0 {
            addMimePatterns(mimes, patterns, accepted)
        }
        let filtering = filter != nil
        return (entry FileEntry) -> {
            if entry.IsDirectory {
                return true
            }
            if directoriesOnly {
                return false
            }
            if !filtering {
                return true
            }
            for pattern in patterns {
                if matchName(pattern.Value, entry.Name, pattern.Flags) == 0 {
                    return true
                }
            }
            return false
        }
    }

    internal func Validate(
        pane BrowserPane,
        name string,
        filter PortalFilter?,
        choices IReadOnlyDictionary[string, string],
        replace bool = false
    ) ChooserValidation {
        try {
            if pane.Loading {
                throw IOException("Wait for the folder to finish loading")
            }
            let result = PortalChooserResult{Response: 0u, CurrentFilter: filter}
            addChoices(result, choices)
            let paths = List[string]()
            let replacements = List[string]()
            if Saving {
                validateName(name)
                let folder = requireDirectory(pane.DirectoryPath, 3)
                let destination = Path.Combine(folder, name)
                if exists(destination) {
                    requireFile(destination, 2)
                    replacements.Add(destination)
                }
                paths.Add(destination)
            } else if SavingMany {
                let folder = requireDirectory(selectedFolder(pane), 3)
                if Request.Files.Count == 0 {
                    throw IOException("No file names were supplied")
                }
                let used = HashSet[string](StringComparer.Ordinal)
                for requested in Request.Files {
                    validateName(requested)
                    var leaf = requested
                    var number = 0
                    while used.Contains(leaf) || exists(Path.Combine(folder, leaf)) {
                        number++
                        leaf = uniqueName(requested, number)
                    }
                    used.Add(leaf)
                    paths.Add(Path.Combine(folder, leaf))
                }
            } else if Request.Method == "OpenFile" {
                if Request.Directory {
                    let selected = selectedPaths(pane)
                    if selected.Count == 0 {
                        paths.Add(requireDirectory(pane.DirectoryPath, 5))
                    } else {
                        if !Request.Multiple && selected.Count > 1 {
                            throw IOException("Select one folder")
                        }
                        for path in selected {
                            paths.Add(requireDirectory(path, 5))
                        }
                    }
                } else {
                    let selected = selectedPaths(pane)
                    if selected.Count == 0 {
                        throw IOException("Select a file")
                    }
                    if !Request.Multiple && selected.Count > 1 {
                        throw IOException("Select one file")
                    }
                    for path in selected {
                        paths.Add(requireFile(path, 4))
                    }
                }
            } else {
                throw IOException("Unsupported file chooser method")
            }
            if replacements.Count > 0 && !replace {
                return ChooserValidation{ReplacePaths: replacements}
            }
            for path in paths {
                result.Uris.Add("file://" + Uri.EscapeDataString(path).Replace("%2F", "/"))
            }
            return ChooserValidation{Result: result}
        } catch (failure Exception) {
            return ChooserValidation{Error: failure.Message}
        }
    }

    private func selectedPaths(pane BrowserPane) List[string] {
        let paths = List[string]()
        for entry in pane.VisibleEntries {
            if pane.SelectedPaths.Contains(entry.FullPath) {
                paths.Add(entry.FullPath)
            }
        }
        if paths.Count != pane.SelectedPaths.Count {
            throw IOException("The selection changed. Select the items again")
        }
        return paths
    }

    private func selectedFolder(pane BrowserPane) string {
        let selected = selectedPaths(pane)
        if selected.Count > 1 {
            throw IOException("Select one destination folder")
        }
        return selected.Count == 0 ? pane.DirectoryPath: selected[0]
    }

    private func addChoices(result PortalChooserResult, values IReadOnlyDictionary[string, string]) {
        for choice in Request.Choices {
            if !values.TryGetValue(choice.Id, out var value) {
                throw IOException("Choose a value for " + choice.Label)
            }
            var valid = false
            if choice.Options.Count == 0 {
                valid = value == "true" || value == "false"
            } else {
                for option in choice.Options {
                    if option.Id == value {
                        valid = true
                        break
                    }
                }
            }
            if !valid {
                throw IOException("Invalid choice for " + choice.Label)
            }
            result.Choices.Add(PortalChoiceResult{Id: choice.Id, Value: value})
        }
    }

    private func validateName(name string) {
        if name == "" || name.Trim() == "" || name == "." || name == ".." || name.Contains('/')
        || name.Contains('\0') || UTF8Encoding(false, true).GetByteCount(name) > 255 {
            throw IOException("Enter a single valid file name")
        }
    }

    private func uniqueName(name string, number int32) string {
        let extension = Path.GetExtension(name)
        var suffix = " (" + number.ToString() + ")" + extension
        var stem = name.Substring(0, name.Length - extension.Length)
        if Encoding.UTF8.GetByteCount(suffix) > 255 {
            suffix = " (" + number.ToString() + ")"
            stem = name
        }
        var length = stem.Length
        while length > 0 && Encoding.UTF8.GetByteCount(stem.Substring(0, length) + suffix) > 255 {
            length--
            if length > 0 && Char.IsHighSurrogate(stem[length - 1]) {
                length--
            }
        }
        let candidate = stem.Substring(0, length) + suffix
        validateName(candidate)
        return candidate
    }

    private func accessibleDirectory(path string) bool {
        try {
            requireDirectory(path, 5)
            return true
        } catch (failure Exception) {
            return false
        }
    }

    private func requireDirectory(path string, access int32) string {
        let fullPath = absolutePath(path)
        if fileType(fullPath) != 16384 {
            throw IOException("Select an accessible folder: " + fullPath)
        }
        requireAccess(fullPath, access)
        return fullPath
    }

    private func requireFile(path string, access int32) string {
        let fullPath = absolutePath(path)
        if fileType(fullPath) != 32768 {
            throw IOException("Select a regular file: " + fullPath)
        }
        requireAccess(fullPath, access)
        return fullPath
    }

    private func absolutePath(path string) string {
        if !Path.IsPathFullyQualified(path) || path.Contains('\0') {
            throw IOException("Only local absolute paths are supported")
        }
        return Path.GetFullPath(path)
    }

    private func fileType(path string) int32 {
        let buffer = Marshal.AllocHGlobal(256)
        try {
            if readStat(-100, path, 0, 1u, buffer) != 0 {
                throw IOException(Win32Exception(Marshal.GetLastWin32Error()).Message + ": " + path)
            }
            return int32(Marshal.ReadInt16(buffer, 28)) & 61440
        } finally {
            Marshal.FreeHGlobal(buffer)
        }
    }

    private func requireAccess(path string, mode int32) {
        if checkAccess(-100, path, mode, 512) != 0 {
            throw IOException(Win32Exception(Marshal.GetLastWin32Error()).Message + ": " + path)
        }
    }

    private func exists(path string) bool {
        try {
            File.GetAttributes(path)
            return true
        } catch (failure FileNotFoundException) {
            return false
        } catch (failure DirectoryNotFoundException) {
            return false
        }
    }

    private func addMimePatterns(mimes List[string], patterns List[ChooserPattern], accepted HashSet[string]) {
        let roots = List[string]()
        let dataHome = Environment.GetEnvironmentVariable("XDG_DATA_HOME") ?? ""
        if Path.IsPathFullyQualified(dataHome) {
            roots.Add(dataHome)
        } else {
            roots.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share"))
        }
        for root in(Environment.GetEnvironmentVariable("XDG_DATA_DIRS") ?? "/usr/local/share:/usr/share").Split(':') {
            if Path.IsPathFullyQualified(root) {
                roots.Add(root)
            }
        }
        let links = List[string]()
        for root in roots {
            for kind in[]string{"aliases", "subclasses"} {
                let path = Path.Combine(root, "mime", kind)
                try {
                    for line in File.ReadLines(path) {
                        let fields = line.Split(' ')
                        if fields.Length == 2 {
                            links.Add(line)
                            if kind == "aliases" {
                                links.Add(fields[1] + " " + fields[0])
                            }
                        }
                    }
                } catch (failure IOException) { } catch (failure UnauthorizedAccessException) { }
            }
        }
        for iteration in 0 ... 64 {
            var changed = false
            for link in links {
                let fields = link.Split(' ')
                if acceptsMime(fields[1], mimes, accepted) && accepted.Add(fields[0]) {
                    changed = true
                }
            }
            if !changed {
                break
            }
        }
        let removed = HashSet[string](StringComparer.Ordinal)
        for root in roots {
            let database = Path.Combine(root, "mime", "globs2")
            if !File.Exists(database) {
                continue
            }
            try {
                let overridden = HashSet[string](StringComparer.Ordinal)
                for line in File.ReadLines(database) {
                    if line.StartsWith('#') {
                        continue
                    }
                    let fields = line.Split(':')
                    if fields.Length < 3 || removed.Contains(fields[1]) {
                        continue
                    }
                    if fields[2] == "__NOGLOBS__" {
                        overridden.Add(fields[1])
                        continue
                    }
                    if acceptsMime(fields[1], mimes, accepted) {
                        let sensitive = fields.Length > 3 && ("," + fields[3] + ",").Contains(",cs,")
                        patterns.Add(ChooserPattern{Value: fields[2], Flags: sensitive ? 0: 16})
                    }
                }
                removed.UnionWith(overridden)
            } catch (failure IOException) { } catch (failure UnauthorizedAccessException) { }
        }
    }

    private func acceptsMime(value string, mimes List[string], accepted HashSet[string]) bool {
        if value == "" {
            return false
        }
        if accepted.Contains(value) {
            return true
        }
        for mime in mimes {
            if value == mime ||
                (
                mime.EndsWith("/*") && value.StartsWith(mime.Substring(0, mime.Length - 1), StringComparison.Ordinal)
            ) {
                return true
            }
        }
        return false
    }

    shared {
        @DllImport("libc", EntryPoint: "fnmatch", CharSet: CharSet.Ansi)
        private func matchName(pattern string, name string, flags int32) int32;

        @DllImport("libc", EntryPoint: "statx", CharSet: CharSet.Ansi, SetLastError: true)
        private func readStat(directory int32, path string, flags int32, mask uint32, buffer IntPtr) int32;

        @DllImport("libc", EntryPoint: "faccessat", CharSet: CharSet.Ansi, SetLastError: true)
        private func checkAccess(directory int32, path string, mode int32, flags int32) int32;
    }
}
