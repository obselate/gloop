package gloop

import System
import System.Collections.Generic
import System.IO

class FileTransferService {
    private var lastPaths IReadOnlyList[string]?
    private var lastDestination string
    private var lastValid bool

    internal func Clear() {
        lastPaths = nil
        lastDestination = ""
        lastValid = false
    }

    internal func Snapshot(pane BrowserPane, sourcePath string) FileDragPayload? {
        var found bool
        for entry in pane.VisibleEntries {
            if entry.FullPath == sourcePath {
                found = true
                break
            }
        }
        if !found {
            return nil
        }
        let paths = List[string]()
        if pane.SelectedPaths.Contains(sourcePath) {
            for entry in pane.VisibleEntries {
                if pane.SelectedPaths.Contains(entry.FullPath) {
                    paths.Add(entry.FullPath)
                }
            }
        } else {
            paths.Add(sourcePath)
        }
        return FileDragPayload(paths)
    }

    internal func ValidTarget(paths IReadOnlyList[string], destination string, preview bool) bool {
        if Object.ReferenceEquals(lastPaths, paths) && lastDestination == destination {
            return lastValid
        }
        let valid = Path.IsPathFullyQualified(destination) && Directory.Exists(destination)
        && (preview || (paths.Count > 0 && ValidPaths(paths, destination)))
        lastPaths = paths
        lastDestination = destination
        lastValid = valid
        return valid
    }

    private func ValidPaths(paths IReadOnlyList[string], destination string) bool {
        let target = Path.GetFullPath(destination)
        for path in paths {
            if !Path.IsPathFullyQualified(path) {
                return false
            }
            var source string
            try {
                source = Path.GetFullPath(path)
            } catch (failure Exception) {
                return false
            }
            if Path.GetDirectoryName(source) == target {
                return false
            }
            let relative = Path.GetRelativePath(source, target)
            if relative == "." || (relative != ".." && !relative.StartsWith("../") && !Path.IsPathRooted(relative)) {
                return false
            }
        }
        return true
    }
}
