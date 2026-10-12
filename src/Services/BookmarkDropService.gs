package gloop

import System
import System.Collections.Generic
import System.IO

internal class BookmarkDropService {
    private var lastPaths IReadOnlyList[string]?
    private var lastValid bool

    internal func Valid(paths IReadOnlyList[string], preview bool) bool {
        if preview {
            return true
        }
        if !Object.ReferenceEquals(lastPaths, paths) {
            lastPaths = paths
            lastValid = NormalizePaths(paths) != nil
        }
        return lastValid
    }

    internal func Clear() {
        lastPaths = nil
        lastValid = false
    }

    shared {
        internal func NormalizePaths(paths IReadOnlyList[string]) List[string]? {
            if paths.Count == 0 {
                return nil
            }
            let folders = List[string]()
            let seen = HashSet[string](StringComparer.Ordinal)
            for path in paths {
                let normalized = BookmarkPath.Normalize(path)
                if normalized == "" || !Directory.Exists(normalized) {
                    return nil
                }
                if seen.Add(normalized) {
                    folders.Add(normalized)
                }
            }
            return folders
        }
    }
}
