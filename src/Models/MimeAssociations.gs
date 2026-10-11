package gloop

import System
import System.Collections.Generic
import System.IO

data struct MimeAppsFile {
    internal var Defaults Dictionary[string, string]
    internal var Added Dictionary[string, string]
    internal var Removed Dictionary[string, string]
}

class MimeAssociations {
    private let files List[MimeAppsFile] = List[MimeAppsFile]()
    private let caches List[Dictionary[string, string]] = List[Dictionary[string, string]]()

    /// Loads the mimeapps.list files in the order of the XDG MIME Applications specification, then every mimeinfo.cache.
    internal init() {
        let names = List[string]()
        for desktop in(Environment.GetEnvironmentVariable("XDG_CURRENT_DESKTOP") ?? "").Split(
            ':',
            StringSplitOptions.RemoveEmptyEntries
        ) {
            names.Add(desktop.ToLowerInvariant() + "-mimeapps.list")
        }
        names.Add("mimeapps.list")
        let directories = Xdg.ConfigDirs()
        for root in Xdg.DataDirs() {
            directories.Add(Path.Combine(root, "applications"))
        }
        for directory in directories {
            for name in names {
                let groups = Xdg.Groups(Path.Combine(directory, name))
                files.Add(
                    MimeAppsFile{
                        Defaults: section(groups, "Default Applications"),
                        Added: section(groups, "Added Associations"),
                        Removed: section(groups, "Removed Associations"),
                    }
                )
            }
        }
        for root in Xdg.DataDirs() {
            caches.Add(section(Xdg.Groups(Path.Combine(root, "applications", "mimeinfo.cache")), "MIME Cache"))
        }
    }

    /// Returns the desktop file ids for a type and its aliases. Default Applications come first, then Added
    /// Associations, then the caches. A Removed Association hides an id from the files of lower priority.
    internal func Ids(names List[string]) List[string] {
        let defaults = List[string]()
        let added = List[string]()
        let removed = HashSet[string]()
        for file in files {
            let denied = HashSet[string](removed)
            for name in names {
                collect(defaults, file.Defaults, name, denied)
                collect(added, file.Added, name, denied)
                removed.UnionWith(split(file.Removed, name))
            }
        }
        let ids = List[string](defaults)
        ids.AddRange(added)
        for cache in caches {
            for name in names {
                ids.AddRange(split(cache, name))
            }
        }
        ids.RemoveAll(id -> removed.Contains(id))
        return ids
    }

    private func section(groups Dictionary[string, Dictionary[string, string]], name string) Dictionary[
        string,
        string
    ] -> groups.TryGetValue(name, out var found) ? found: Dictionary[string, string]()

    private func split(entries Dictionary[string, string], name string)[]string -> entries.TryGetValue(
        name,
        out var value
    ) ? value.Split(';', StringSplitOptions.RemoveEmptyEntries): []string{}

    private func collect(target List[string], entries Dictionary[string, string], name string, denied HashSet[string]) {
        for id in split(entries, name) {
            if !denied.Contains(id) {
                target.Add(id)
            }
        }
    }
}
