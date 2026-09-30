package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

internal class BookmarkDropService {
    private var lastValue object?
    private var lastValid bool

    internal func Effect(data DragData) DragEffect {
        if (int32(data.AllowedEffects) & int32(DragEffect.Copy)) == 0 {
            return DragEffect.None
        }
        if let incoming = data.Value as NativeFileDrop? {
            if incoming.IsPreview {
                return DragEffect.Copy
            }
        }
        if !Object.ReferenceEquals(lastValue, data.Value) {
            lastValue = data.Value
            lastValid = Paths(data).Count > 0
        }
        return lastValid ? DragEffect.Copy: DragEffect.None
    }

    internal func Paths(data DragData) List[string] {
        if let payload = data.Value as FileDragPayload? {
            return NormalizePaths(payload.Paths) ?? List[string]()
        }
        if let incoming = data.Value as NativeFileDrop? {
            if !incoming.IsPreview {
                return NormalizePaths(incoming.Paths) ?? List[string]()
            }
        }
        return List[string]()
    }

    internal func Clear() {
        lastValue = nil
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
