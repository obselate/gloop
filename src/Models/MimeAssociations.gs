package gloop

import System
import System.Collections.Generic

class MimeAssociations {
    private let files List[MimeAppsFile] = List[MimeAppsFile]()
    private let caches List[Dictionary[string, string]] = List[Dictionary[string, string]]()

    internal init(
        groups List[Dictionary[string, Dictionary[string, string]]],
        cacheGroups List[Dictionary[string, Dictionary[string, string]]]
    ) {
        for group in groups {
            files.Add(
                MimeAppsFile{
                    Defaults: section(group, "Default Applications"),
                    Added: section(group, "Added Associations"),
                    Removed: section(group, "Removed Associations"),
                }
            )
        }
        for group in cacheGroups {
            caches.Add(section(group, "MIME Cache"))
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
