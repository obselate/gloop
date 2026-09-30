package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

class FileTransferService {
    private var lastValue object?
    private var lastDestination string
    private var lastValid bool

    internal func Clear() {
        lastValue = nil
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

    internal func Effect(data DragData, destination string, copy bool) DragEffect {
        if let payload = data.Value as FileDragPayload? {
            if !ValidTarget(data.Value, payload.Paths, destination, false) {
                return DragEffect.None
            }
            let effect = copy ? DragEffect.Copy: DragEffect.Move
            return (int32(data.AllowedEffects) & int32(effect)) != 0 ? effect: DragEffect.None
        }
        if let incoming = data.Value as NativeFileDrop? {
            if (int32(data.AllowedEffects) & int32(DragEffect.Copy)) == 0 {
                return DragEffect.None
            }
            if !ValidTarget(data.Value, incoming.Paths, destination, incoming.IsPreview) {
                return DragEffect.None
            }
            return DragEffect.Copy
        }
        return DragEffect.None
    }

    internal func Sources(data DragData) List[string] {
        if let payload = data.Value as FileDragPayload? {
            return List[string](payload.Paths)
        }
        let paths = List[string]()
        if let incoming = data.Value as NativeFileDrop? {
            if !incoming.IsPreview {
                for path in incoming.Paths {
                    paths.Add(path)
                }
            }
        }
        return paths
    }

    private func ValidTarget(value object, paths IReadOnlyList[string], destination string, preview bool) bool {
        if Object.ReferenceEquals(lastValue, value) && lastDestination == destination {
            return lastValid
        }
        let valid = Path.IsPathFullyQualified(destination) && Directory.Exists(destination)
        && (preview || (paths.Count > 0 && ValidPaths(paths, destination)))
        lastValue = value
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
