package gloop

import System.Collections.Generic

class BrowserPane {
    internal var DirectoryPath string
    internal var Entries List[FileEntry]
    internal var VisibleEntries List[FileEntry]
    internal var Selected int32
    internal let SelectedPaths HashSet[string]
    internal var SelectionAnchorPath string
    internal var PendingFocusPath string
    internal var Filter string
    internal var SortColumn string
    internal var Descending bool
    internal var Loading bool
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
        SortColumn = "name"
        Descending = false
        Loading = false
        Error = ""
        History = List[string]()
        HistoryIndex = -1
    }

    internal func CanBack() bool -> HistoryIndex > 0

    internal func CanForward() bool -> HistoryIndex >= 0 && HistoryIndex < History.Count - 1
}
