package gloop

import System
import System.Collections.Generic

class BrowserPane {
    internal var DirectoryPath string
    internal var Kind LocationKind
    internal var AtTrashRoot bool
    internal var Entries List[FileEntry]
    internal var VisibleEntries List[FileEntry]
    internal var Selected int32
    internal let SelectedPaths HashSet[string]
    internal var SelectionAnchorPath string
    internal var PendingFocusPath string
    internal var Filter string
    internal var SortColumn SortColumn
    internal var Descending bool
    internal var Loading bool
    internal var Refreshing bool
    internal var Error string
    internal let History List[string]
    internal var HistoryIndex int32
    internal var LoadGeneration int32
    internal var ViewGeneration int32

    internal init() {
        DirectoryPath = ""
        Entries = List[FileEntry]()
        VisibleEntries = List[FileEntry]()
        Selected = -1
        SelectedPaths = HashSet[string](StringComparer.Ordinal)
        SelectionAnchorPath = ""
        PendingFocusPath = ""
        Filter = ""
        SortColumn = SortColumn.Name
        Descending = false
        Loading = false
        Error = ""
        History = List[string]()
        HistoryIndex = -1
    }

    internal func CanBack() bool -> HistoryIndex > 0

    internal func CanForward() bool -> HistoryIndex >= 0 && HistoryIndex < History.Count - 1

    internal func SelectedEntry() FileEntry? {
        if Selected < 0 || Selected >= VisibleEntries.Count {
            return nil
        }
        return VisibleEntries[Selected]
    }

    internal func SingleSelectedEntry() FileEntry? {
        if SelectedPaths.Count != 1 {
            return nil
        }
        for entry in VisibleEntries {
            if SelectedPaths.Contains(entry.FullPath) {
                return entry
            }
        }
        return nil
    }

    internal func SelectedSize() int64 {
        var size int64 = -1
        for entry in VisibleEntries {
            if !entry.IsDirectory && SelectedPaths.Contains(entry.FullPath) {
                size = Math.Max(size, 0) + entry.Size
            }
        }
        return size
    }

    internal func SelectionSummary() string {
        if let entry = SingleSelectedEntry() {
            return entry.Name
        }
        let count = SelectedPaths.Count
        return count == 0 ? "": count.ToString() + " items"
    }

    internal func SelectionPaths() List[string] {
        let sources = List[string]()
        for entry in VisibleEntries {
            if SelectedPaths.Contains(entry.FullPath) {
                sources.Add(entry.FullPath)
            }
        }
        return sources
    }

    internal func FindPrefix(prefix string, start int32) int32 {
        let count = VisibleEntries.Count
        if count == 0 {
            return -1
        }
        let first = Math.Max(0, start) % count
        for offset in 0 ... count {
            let index = (first + offset) % count
            if VisibleEntries[index].Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) {
                return index
            }
        }
        return -1
    }

    internal func UpdateHistory(path string, mode DirectoryMode, historyIndex int32) {
        if mode == DirectoryMode.Push {
            if HistoryIndex < History.Count - 1 {
                History.RemoveRange(HistoryIndex + 1, History.Count - HistoryIndex - 1)
            }
            if History.Count == 0 || History[History.Count - 1] != path {
                History.Add(path)
            }
            HistoryIndex = History.Count - 1
        } else if mode == DirectoryMode.History {
            HistoryIndex = historyIndex
        }
    }

    internal func SelectIndex(index int32, ctrl bool, shift bool, focusOnly bool) bool {
        let next = if VisibleEntries.Count == 0 {
            -1
        } else {
            Math.Clamp(index, 0, VisibleEntries.Count - 1)
        }
        if next < 0 {
            return false
        }
        let previous = Selected
        let path = VisibleEntries[next].FullPath
        if shift {
            var anchor = -1
            for i in 0 ... VisibleEntries.Count {
                if VisibleEntries[i].FullPath == SelectionAnchorPath {
                    anchor = i
                    break
                }
            }
            if anchor < 0 {
                anchor = previous >= 0 ? previous: next
                SelectionAnchorPath = VisibleEntries[anchor].FullPath
            }
            if !ctrl {
                SelectedPaths.Clear()
            }
            for i in Math.Min(anchor, next) ... Math.Max(anchor, next) + 1 {
                SelectedPaths.Add(VisibleEntries[i].FullPath)
            }
        } else if !focusOnly {
            if ctrl {
                if !SelectedPaths.Remove(path) {
                    SelectedPaths.Add(path)
                }
            } else {
                SelectedPaths.Clear()
                SelectedPaths.Add(path)
            }
            SelectionAnchorPath = path
        }
        Selected = next
        return true
    }

    internal func SelectAll() bool {
        if VisibleEntries.Count == 0 {
            return false
        }
        SelectedPaths.Clear()
        for entry in VisibleEntries {
            SelectedPaths.Add(entry.FullPath)
        }
        if Selected < 0 {
            Selected = 0
        }
        SelectionAnchorPath = VisibleEntries[Selected].FullPath
        return true
    }

    internal func ClearSelection() bool {
        if SelectedPaths.Count == 0 {
            return false
        }
        SelectedPaths.Clear()
        SelectionAnchorPath = FocusedPath()
        return true
    }

    internal func RetargetSelection(source string, destination string) {
        if SelectedPaths.Remove(source) {
            SelectedPaths.Add(destination)
        }
        if SelectionAnchorPath == source {
            SelectionAnchorPath = destination
        }
    }

    internal func SelectionPath() string {
        if Selected < 0 || Selected >= VisibleEntries.Count {
            return ""
        }
        return VisibleEntries[Selected].FullPath
    }

    internal func FocusedPath() string {
        let selected = SelectionPath()
        return selected == "" ? PendingFocusPath: selected
    }

    internal func ReconcileSelection(entries List[FileEntry], selectedPath string, selectFirstEntry bool) {
        let currentPath = FocusedPath()
        let focusPath = currentPath == "" ? selectedPath: currentPath
        VisibleEntries = entries
        let previous = Refreshing ? Selected: 0
        Selected = entries.Count == 0 ? -1: Math.Clamp(previous, 0, entries.Count - 1)
        PendingFocusPath = ""
        let missing = HashSet[string](SelectedPaths, StringComparer.Ordinal)
        var focused = focusPath == ""
        var fallback = -1
        var anchorVisible = false
        for i in 0 ... entries.Count {
            let path = entries[i].FullPath
            if !focused && path == focusPath {
                Selected = i
                focused = true
            }
            if path == selectedPath {
                fallback = i
            }
            if missing.Count > 0 {
                missing.Remove(path)
            }
            if !anchorVisible && path == SelectionAnchorPath {
                anchorVisible = true
            }
        }
        if !focused && fallback >= 0 {
            Selected = fallback
            Refreshing = false
        }
        for path in missing {
            SelectedPaths.Remove(path)
        }
        if missing.Count > 0 && SelectedPaths.Count == 0 && Selected >= 0 {
            SelectedPaths.Add(entries[Selected].FullPath)
        }
        if selectFirstEntry && SelectedPaths.Count == 0 && SelectionAnchorPath == "" && Selected >= 0 {
            SelectedPaths.Add(entries[Selected].FullPath)
        }
        if !anchorVisible {
            SelectionAnchorPath = SelectionPath()
        }
    }
}
