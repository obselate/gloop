package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

class BrowserController {
    internal let First BrowserPane
    internal let Second BrowserPane
    internal var ActiveIndex int32
    internal var Split bool
    internal var PreviewVisible bool
    internal var Preview PreviewData
    internal var PreviewImage ImageSource?
    internal var Status string
    internal var SelectFirstEntry bool = true
    internal var EntryFilter Func[FileEntry, bool]?
    internal let Places PlacesService
    internal let TrashDirectory string = TrashService().FilesDirectory()

    private let window Window
    private let settings AppSettings
    private let changed Action
    private let resetTypeSelect Action
    private let loads[]DirectoryWorkQueue
    private let views[]ViewWorkQueue
    private let operations OperationWorkQueue
    private let previews PreviewWorkQueue
    private var previewGeneration int32
    private var previewWidth int32
    private var previewHeight int32
    private var targetPreviewWidth int32
    private var targetPreviewHeight int32
    private var loadedPreviewWidth int32
    private var loadedPreviewHeight int32
    private var previewAtOriginalSize bool
    private var previewResizeError string = ""
    private var operationCount int32
    private let clipboardPaths List[string]
    private var clipboardCut bool
    private var clipboardGeneration int32
    private let movingSources HashSet[string]
    private var closeRequested bool
    private var closeFailure string
    private var terminalOpening bool
    private var disposed bool

    internal init(
        window Window,
        settings AppSettings,
        changed Action,
        resetTypeSelect Action,
        previewWidth int32,
        previewHeight int32
    ) {
        this.window = window
        this.settings = settings
        this.changed = changed
        this.resetTypeSelect = resetTypeSelect
        this.previewWidth = previewWidth
        this.previewHeight = previewHeight
        targetPreviewWidth = previewWidth
        targetPreviewHeight = previewHeight
        First = BrowserPane()
        Second = BrowserPane()
        ActiveIndex = 0
        Split = settings.SplitView
        PreviewVisible = settings.ShowPreview
        Preview = PreviewData{Kind: "", Text: "", Path: "", Error: ""}
        Status = ""
        clipboardPaths = List[string]()
        closeFailure = ""
        movingSources = HashSet[string](StringComparer.Ordinal)
        loads = [2]DirectoryWorkQueue
        loads[0] = DirectoryWorkQueue()
        loads[1] = DirectoryWorkQueue()
        views = [2]ViewWorkQueue
        views[0] = ViewWorkQueue()
        views[1] = ViewWorkQueue()
        operations = OperationWorkQueue()
        previews = PreviewWorkQueue()
        Places = PlacesService(window, changed)
    }

    internal func ActivePane() BrowserPane -> Pane(ActiveIndex)

    internal prop IsOperating bool {
        get -> operationCount > 0
    }

    internal prop ReadyToClose bool {
        get -> closeRequested && !IsOperating && closeFailure == ""
    }

    internal prop AcceptingOperations bool {
        get -> !disposed && !closeRequested
    }

    internal prop IsDisposed bool {
        get -> disposed
    }

    internal prop PreviewVersion int32 {
        get -> previewGeneration
    }

    internal prop PreviewResizeFailed bool {
        get -> previewResizeError != ""
    }

    internal prop InRecent bool {
        get -> Locations.IsRecent(ActivePane().DirectoryPath)
    }

    internal prop InTrashView bool {
        get -> InTrash(ActivePane().DirectoryPath)
    }

    internal prop AtTrashRoot bool {
        get -> TrashDirectory != "" && ActivePane().DirectoryPath == TrashDirectory
    }

    internal func InTrash(path string) bool -> TrashDirectory != "" &&
        (path == TrashDirectory || path.StartsWith(TrashDirectory + "/", StringComparison.Ordinal))

    internal func CloseSafely() bool {
        if !IsOperating {
            return true
        }
        closeRequested = true
        Status = "Finishing file operations before exit"
        Notify()
        return false
    }

    internal func Pane(index int32) BrowserPane -> index == 1 ? Second: First

    internal func SelectedEntry() FileEntry? {
        let pane = ActivePane()
        if pane.Selected < 0 || pane.Selected >= pane.VisibleEntries.Count {
            return nil
        }
        return pane.VisibleEntries[pane.Selected]
    }

    internal func SelectedCount() int32 -> ActivePane().SelectedPaths.Count

    internal func SingleSelectedEntry() FileEntry? {
        let pane = ActivePane()
        if pane.SelectedPaths.Count != 1 {
            return nil
        }
        for entry in pane.VisibleEntries {
            if pane.SelectedPaths.Contains(entry.FullPath) {
                return entry
            }
        }
        return nil
    }

    internal func SelectedSize() int64 {
        let pane = ActivePane()
        var size int64 = -1
        for entry in pane.VisibleEntries {
            if !entry.IsDirectory && pane.SelectedPaths.Contains(entry.FullPath) {
                size = Math.Max(size, 0) + entry.Size
            }
        }
        return size
    }

    internal func SelectionSummary() string {
        if let entry = SingleSelectedEntry() {
            return entry.Name
        }
        let count = SelectedCount()
        return count == 0 ? "": count.ToString() + " items"
    }

    internal func Start(path string, selectedPath string = "") {
        NavigateTo(path, 0, "push", -1, selectedPath)
        if Split {
            NavigateTo(path, 1, "push", -1, "")
        }
    }

    internal func Navigate(path string, paneIndex int32 = -1) {
        let index = if paneIndex < 0 {
            ActiveIndex
        } else {
            paneIndex
        }
        NavigateTo(path, index, "push", -1, "")
    }

    internal func Back() {
        let pane = ActivePane()
        if pane.CanBack() {
            NavigateTo(
                pane.History[pane.HistoryIndex - 1],
                ActiveIndex,
                "history",
                pane.HistoryIndex - 1,
                pane.DirectoryPath
            )
        }
    }

    internal func Forward() {
        let pane = ActivePane()
        if pane.CanForward() {
            NavigateTo(pane.History[pane.HistoryIndex + 1], ActiveIndex, "history", pane.HistoryIndex + 1, "")
        }
    }

    internal func Parent() {
        let path = ActivePane().DirectoryPath
        if path == "" {
            return
        }
        if Locations.IsRecent(path) {
            Navigate(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))
            return
        }
        let parent = Path.GetDirectoryName(path)
        if parent != nil && parent != path {
            NavigateTo(parent, ActiveIndex, "push", -1, path)
        }
    }

    internal func ShowInFolder() {
        guard let entry = SingleSelectedEntry() else {
            return
        }
        if let directory = Path.GetDirectoryName(entry.FullPath) {
            NavigateTo(directory, ActiveIndex, "push", -1, entry.FullPath)
        }
    }

    internal func LeaveMount(mountPath string) {
        let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        for index in 0 ... 2 {
            let path = Pane(index).DirectoryPath
            if path == mountPath || path.StartsWith(mountPath.TrimEnd('/') + "/", StringComparison.Ordinal) {
                Navigate(home, index)
            }
        }
    }

    internal func Refresh() {
        Places.Refresh()
        let pane = ActivePane()
        if pane.DirectoryPath != "" {
            NavigateTo(pane.DirectoryPath, ActiveIndex, "refresh", pane.HistoryIndex, FocusedPath(pane))
        }
    }

    internal func Select(index int32, ctrl bool = false, shift bool = false) {
        ResetTypeSelect()
        SelectIndex(index, ctrl, shift, false)
    }

    internal func SelectPrefix(index int32) {
        SelectIndex(index, false, false, false)
    }

    private func SelectIndex(index int32, ctrl bool, shift bool, focusOnly bool) {
        let pane = ActivePane()
        let next = if pane.VisibleEntries.Count == 0 {
            -1
        } else {
            Math.Clamp(index, 0, pane.VisibleEntries.Count - 1)
        }
        if next < 0 {
            return
        }
        let previous = pane.Selected
        let path = pane.VisibleEntries[next].FullPath
        if shift {
            var anchor = -1
            for i in 0 ... pane.VisibleEntries.Count {
                if pane.VisibleEntries[i].FullPath == pane.SelectionAnchorPath {
                    anchor = i
                    break
                }
            }
            if anchor < 0 {
                anchor = previous >= 0 ? previous: next
                pane.SelectionAnchorPath = pane.VisibleEntries[anchor].FullPath
            }
            if !ctrl {
                pane.SelectedPaths.Clear()
            }
            for i in Math.Min(anchor, next) ... Math.Max(anchor, next) + 1 {
                pane.SelectedPaths.Add(pane.VisibleEntries[i].FullPath)
            }
        } else if !focusOnly {
            if ctrl {
                if !pane.SelectedPaths.Remove(path) {
                    pane.SelectedPaths.Add(path)
                }
            } else {
                pane.SelectedPaths.Clear()
                pane.SelectedPaths.Add(path)
            }
            pane.SelectionAnchorPath = path
        }
        pane.Selected = next
        if previous != next {
            QueuePreview()
        }
        Notify()
    }

    internal func MoveTo(index int32, ctrl bool = false, shift bool = false) {
        ResetTypeSelect()
        SelectIndex(index, ctrl, shift, ctrl && !shift)
    }

    internal func MoveSelection(delta int32, ctrl bool = false, shift bool = false) {
        let pane = ActivePane()
        if pane.VisibleEntries.Count == 0 {
            return
        }
        MoveTo(Math.Clamp(pane.Selected + delta, 0, pane.VisibleEntries.Count - 1), ctrl, shift)
    }

    internal func SelectAll() {
        let pane = ActivePane()
        if pane.VisibleEntries.Count == 0 {
            return
        }
        pane.SelectedPaths.Clear()
        for entry in pane.VisibleEntries {
            pane.SelectedPaths.Add(entry.FullPath)
        }
        if pane.Selected < 0 {
            pane.Selected = 0
            QueuePreview()
        }
        pane.SelectionAnchorPath = pane.VisibleEntries[pane.Selected].FullPath
        Notify()
    }

    internal func ToggleFocusedSelection() {
        let pane = ActivePane()
        if pane.Selected < 0 || pane.Selected >= pane.VisibleEntries.Count {
            return
        }
        SelectIndex(pane.Selected, true, false, false)
    }

    internal func ClearSelection() {
        let pane = ActivePane()
        if pane.SelectedPaths.Count == 0 {
            return
        }
        pane.SelectedPaths.Clear()
        pane.SelectionAnchorPath = FocusedPath(pane)
        Notify()
    }

    internal func OpenSelected() {
        ResetTypeSelect()
        guard let entry = SelectedEntry() else {
            return
        }
        if entry.IsDirectory {
            Navigate(entry.FullPath)
        } else if !InTrashView {
            let owner = window
            let controller = this
            go browserOpen(owner, controller, entry.FullPath)
        }
    }

    internal func ToggleHidden() {
        settings.ShowHidden = !settings.ShowHidden
        settings.LaunchShowHiddenOriginal = nil
        RefreshLoadedPanes()
        Notify()
    }

    internal func SetViewMode(mode string) {
        if (mode != "list" && mode != "tiles") || settings.ViewMode == mode {
            return
        }
        settings.ViewMode = mode
        Notify()
    }

    internal func OpenTerminal(inSelection bool = true) {
        var directory = ActivePane().DirectoryPath
        if inSelection {
            if let entry = SingleSelectedEntry() {
                if entry.IsDirectory {
                    directory = entry.FullPath
                }
            }
        }
        if disposed || directory == "" || Locations.IsRecent(directory) || terminalOpening {
            return
        }
        terminalOpening = true
        let owner = window
        let controller = this
        go browserOpenTerminal(owner, controller, directory)
    }

    internal func TogglePreview() {
        PreviewVisible = !PreviewVisible
        settings.ShowPreview = PreviewVisible
        QueuePreview()
        Notify()
    }

    internal func ToggleSplit() {
        ResetTypeSelect()
        Split = !Split
        settings.SplitView = Split
        if Split && Second.DirectoryPath == "" && First.DirectoryPath != "" {
            NavigateTo(First.DirectoryPath, 1, "push", -1, "")
        }
        if !Split {
            ActiveIndex = 0
        }
        QueuePreview()
        Notify()
    }

    internal func SwitchPane() {
        if Split {
            SetActive(1 - ActiveIndex)
        }
    }

    internal func SetActive(index int32) {
        if index < 0 || index > 1 || (!Split && index == 1) || index == ActiveIndex {
            return
        }
        ActiveIndex = index
        ResetTypeSelect()
        QueuePreview()
        Notify()
    }

    internal func SetEntryFilter(value Func[FileEntry, bool]?) {
        EntryFilter = value
        for index in 0 ... 2 {
            let pane = Pane(index)
            if pane.Entries.Count > 0 {
                RequestView(index, SelectionPath(pane))
            }
        }
        Notify()
    }

    internal func SetFilter(value string) {
        let pane = ActivePane()
        if pane.Filter == value {
            return
        }
        ResetTypeSelect()
        pane.Filter = value
        if pane.Loading && pane.Entries.Count == 0 {
            Notify()
            return
        }
        RequestView(ActiveIndex, SelectionPath(pane))
        Notify()
    }

    internal func Sort(column string) {
        if column != "name" && column != "size" && column != "modified" && column != "kind" {
            return
        }
        ResetTypeSelect()
        let pane = ActivePane()
        if pane.SortColumn == column {
            pane.Descending = !pane.Descending
        } else {
            pane.SortColumn = column
            pane.Descending = false
        }
        if pane.Loading && pane.Entries.Count == 0 {
            Notify()
            return
        }
        RequestView(ActiveIndex, SelectionPath(pane))
        Notify()
    }

    internal func Copy(cut bool = false) {
        let sources = SelectedPaths()
        if sources.Count == 0 {
            return
        }
        clipboardPaths.Clear()
        for source in sources {
            clipboardPaths.Add(source)
        }
        clipboardCut = cut
        clipboardGeneration++
        Status = (cut ? "Cut ": "Copied ") + SelectionSummary()
        Notify()
    }

    internal prop HasClipboard bool {
        get -> clipboardPaths.Count > 0
    }

    internal func Paste() {
        let destination = ActivePane().DirectoryPath
        if clipboardPaths.Count == 0 || destination == "" || DropBlocked(destination) {
            return
        }
        StartOperation(
            clipboardCut ? OperationKind.Move: OperationKind.Copy,
            List[string](clipboardPaths),
            destination,
            "",
            clipboardGeneration
        )
    }

    internal func CanDrag(paneIndex int32) bool -> AcceptingOperations &&
        paneIndex >= 0 &&
        paneIndex <= 1 &&
        (paneIndex == 0 || Split) &&
        !InTrash(Pane(paneIndex).DirectoryPath)

    internal func CanDrop(destination string) bool -> AcceptingOperations && !DropBlocked(destination)

    internal func QueueFileDrop(sources List[string], destination string, copy bool) {
        if CanDrop(destination) && sources.Count > 0 {
            StartOperation(copy ? OperationKind.Copy: OperationKind.Move, sources, destination, "")
        }
    }

    internal func DragTooLarge() {
        Status = "Selection is too large to drag into another app"
        Notify()
    }

    internal func CreateFolder(name string) {
        let directory = ActivePane().DirectoryPath
        if directory != "" {
            StartOperation(OperationKind.CreateFolder, directory, "", name)
        }
    }

    internal func Rename(name string) {
        guard let entry = SingleSelectedEntry() else {
            return
        }
        StartOperation(OperationKind.Rename, entry.FullPath, "", name)
    }

    internal func Trash() {
        let sources = SelectedPaths()
        if sources.Count == 0 {
            return
        }
        StartOperation(OperationKind.Trash, sources, "", "")
    }

    internal func Restore() {
        TrashOperation(OperationKind.Restore)
    }

    internal func DeletePermanently() {
        TrashOperation(OperationKind.Delete)
    }

    internal func EmptyTrash() {
        if AtTrashRoot {
            StartOperation(OperationKind.Empty, TrashDirectory, "", "")
        }
    }

    internal func Dispose() {
        if disposed {
            return
        }
        disposed = true
        Places.Dispose()
        closeRequested = false
        for queue in loads {
            queue.Close()
        }
        for queue in views {
            queue.Close()
        }
        operations.Close()
        previews.Close()
        previewGeneration++
        if let source = PreviewImage {
            source.Dispose()
        }
        PreviewImage = nil
    }

    private func NavigateTo(path string, index int32, mode string, historyIndex int32, selectedPath string) {
        if disposed || index < 0 || index > 1 {
            return
        }
        let pane = Pane(index)
        var fullPath string
        try {
            fullPath = Locations.IsRecent(path) ? Locations.Recent: Path.GetFullPath(path)
        } catch (failure Exception) {
            pane.Error = failure.Message
            Status = failure.Message
            Notify()
            return
        }
        pane.LoadGeneration++
        pane.ViewGeneration++
        views[index].Clear()
        if index == ActiveIndex {
            ResetTypeSelect()
        }
        pane.DirectoryPath = fullPath
        pane.PendingFocusPath = selectedPath
        pane.Loading = true
        pane.Error = ""
        pane.Refreshing = mode == "refresh"
        if !pane.Refreshing {
            pane.Entries = List[FileEntry]()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.SelectionAnchorPath = ""
            if index == ActiveIndex {
                QueuePreview()
            }
        }
        Notify()
        let queue = loads[index]
        if queue.Submit(
            DirectoryRequest{
                Index: index,
                Generation: pane.LoadGeneration,
                Path: fullPath,
                ShowHidden: settings.ShowHidden,
                Mode: mode,
                HistoryIndex: historyIndex,
                SelectedPath: selectedPath,
            }
        ) {
            let owner = window
            let controller = this
            go browserLoadWorker(owner, controller, queue)
        }
    }

    internal func ApplyDirectory(
        index int32,
        generation int32,
        snapshot DirectorySnapshot,
        mode string,
        historyIndex int32,
        selectedPath string
    ) {
        if disposed {
            return
        }
        let pane = Pane(index)
        if generation != pane.LoadGeneration {
            return
        }
        pane.DirectoryPath = snapshot.DirectoryPath
        if mode == "push" {
            if pane.HistoryIndex < pane.History.Count - 1 {
                pane.History.RemoveRange(pane.HistoryIndex + 1, pane.History.Count - pane.HistoryIndex - 1)
            }
            if pane.History.Count == 0 || pane.History[pane.History.Count - 1] != snapshot.DirectoryPath {
                pane.History.Add(snapshot.DirectoryPath)
            }
            pane.HistoryIndex = pane.History.Count - 1
        } else if mode == "history" {
            pane.HistoryIndex = historyIndex
        }
        if snapshot.Error != "" {
            pane.Loading = false
            pane.Refreshing = false
            pane.PendingFocusPath = ""
            pane.Entries = List[FileEntry]()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.Error = snapshot.Error
            Status = snapshot.Error
            if index == ActiveIndex {
                QueuePreview()
            }
            Notify()
            return
        }
        pane.Entries = snapshot.Entries
        if mode != "refresh" {
            Status = ""
        }
        RequestView(index, selectedPath)
    }

    private func RequestView(index int32, selectedPath string) {
        let pane = Pane(index)
        pane.ViewGeneration++
        if pane.Entries.Count == 0 {
            views[index].Clear()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.SelectionAnchorPath = ""
            pane.PendingFocusPath = ""
            pane.Loading = false
            if index == ActiveIndex {
                QueuePreview()
            }
            Notify()
            pane.Refreshing = false
            return
        }
        pane.Loading = true
        let queue = views[index]
        if queue.Submit(
            ViewRequest{
                Index: index,
                Generation: pane.ViewGeneration,
                Entries: pane.Entries,
                Filter: pane.Filter,
                EntryFilter: EntryFilter,
                Column: pane.SortColumn,
                Descending: pane.Descending,
                SelectedPath: selectedPath,
            }
        ) {
            let owner = window
            let controller = this
            go browserViewWorker(owner, controller, queue)
        }
    }

    internal func ApplyView(index int32, generation int32, entries List[FileEntry], selectedPath string, error string) {
        if disposed {
            return
        }
        let pane = Pane(index)
        if generation != pane.ViewGeneration {
            return
        }
        let currentPath = FocusedPath(pane)
        let focusPath = currentPath == "" ? selectedPath: currentPath
        pane.Loading = false
        pane.Error = error
        pane.VisibleEntries = entries
        if error == "" && pane.Filter == "" && EntryFilter == nil {
            pane.Entries = entries
        }
        let previous = pane.Refreshing ? pane.Selected: 0
        pane.Selected = entries.Count == 0 ? -1: Math.Clamp(previous, 0, entries.Count - 1)
        pane.PendingFocusPath = ""
        let missing = HashSet[string](pane.SelectedPaths, StringComparer.Ordinal)
        var focused = focusPath == ""
        var fallback = -1
        var anchorVisible = false
        for i in 0 ... entries.Count {
            let path = entries[i].FullPath
            if !focused && path == focusPath {
                pane.Selected = i
                focused = true
            }
            if path == selectedPath {
                fallback = i
            }
            if missing.Count > 0 {
                missing.Remove(path)
            }
            if !anchorVisible && path == pane.SelectionAnchorPath {
                anchorVisible = true
            }
        }
        if !focused && fallback >= 0 {
            pane.Selected = fallback
            pane.Refreshing = false
        }
        for path in missing {
            pane.SelectedPaths.Remove(path)
        }
        if missing.Count > 0 && pane.SelectedPaths.Count == 0 && pane.Selected >= 0 {
            pane.SelectedPaths.Add(entries[pane.Selected].FullPath)
        }
        if SelectFirstEntry && pane.SelectedPaths.Count == 0 && pane.SelectionAnchorPath == "" && pane.Selected >= 0 {
            pane.SelectedPaths.Add(entries[pane.Selected].FullPath)
        }
        if !anchorVisible {
            pane.SelectionAnchorPath = SelectionPath(pane)
        }
        if error != "" {
            Status = error
        }
        if index == ActiveIndex {
            QueuePreview()
        }
        Notify()
        pane.Refreshing = false
    }

    private func QueuePreview() {
        if Status == previewResizeError && previewResizeError != "" {
            Status = ""
        }
        previewResizeError = ""
        previewGeneration++
        previewWidth = targetPreviewWidth
        previewHeight = targetPreviewHeight
        loadedPreviewWidth = 0
        loadedPreviewHeight = 0
        previewAtOriginalSize = false
        Preview = PreviewData{Kind: "", Text: "", Path: "", Error: ""}
        if let source = PreviewImage {
            source.Dispose()
        }
        PreviewImage = nil
        if !PreviewVisible || disposed {
            previews.Clear()
            return
        }
        guard let entry = SelectedEntry() else {
            previews.Clear()
            return
        }
        Preview = PreviewData{Kind: "loading", Path: entry.FullPath}
        if previews.Submit(entry.FullPath, previewGeneration, previewWidth, previewHeight) {
            let owner = window
            let controller = this
            let queue = previews
            go browserPreview(owner, controller, queue)
        }
    }

    internal func NeedsPreviewResize(width int32, height int32) bool -> !disposed &&
        PreviewVisible &&
        PreviewImage != nil &&
        !previewAtOriginalSize &&
        Preview.Kind == "image" &&
        (width > previewWidth || height > previewHeight)

    internal func SetPreviewSize(width int32, height int32) {
        targetPreviewWidth = width
        targetPreviewHeight = height
    }

    internal func RefreshPreviewBounds(width int32, height int32) {
        if !NeedsPreviewResize(width, height) {
            return
        }
        guard let entry = SelectedEntry() else {
            return
        }
        if entry.FullPath != Preview.Path {
            return
        }
        previewGeneration++
        previewWidth = Math.Max(previewWidth, width)
        previewHeight = Math.Max(previewHeight, height)
        if previews.Submit(entry.FullPath, previewGeneration, previewWidth, previewHeight) {
            let owner = window
            let controller = this
            let queue = previews
            go browserPreview(owner, controller, queue)
        }
    }

    internal func ApplyPreview(request PreviewRequest, data PreviewData, source ImageSource?) {
        if disposed || request.Generation != previewGeneration {
            if let stale = source {
                stale.Dispose()
            }
            return
        }
        if data.Kind == "error" && PreviewImage != nil && Preview.Path == request.Path {
            previewWidth = loadedPreviewWidth
            previewHeight = loadedPreviewHeight
            previewResizeError = "Preview resize failed: " + data.Error
            Status = previewResizeError
            Notify()
            return
        }
        if let old = PreviewImage {
            old.Dispose()
        }
        if data.Kind != "error" {
            if Status == previewResizeError && previewResizeError != "" {
                Status = ""
            }
            previewResizeError = ""
        }
        if let image = source {
            loadedPreviewWidth = request.Width
            loadedPreviewHeight = request.Height
            previewAtOriginalSize = image.Width < request.Width && image.Height < request.Height
        } else {
            previewAtOriginalSize = false
        }
        Preview = data
        PreviewImage = source
        Notify()
    }

    private func StartOperation(
        kind OperationKind,
        source string,
        destination string,
        name string,
        clipboardVersion int32 = -1
    ) {
        let sources = List[string]()
        sources.Add(source)
        StartOperation(kind, sources, destination, name, clipboardVersion)
    }

    private func StartOperation(
        kind OperationKind,
        sources List[string],
        destination string,
        name string,
        clipboardVersion int32 = -1
    ) {
        if disposed || closeRequested {
            return
        }
        if sources.Count == 0 {
            return
        }
        if TracksSources(kind) {
            for source in sources {
                if !movingSources.Contains(source) {
                    continue
                }
                Status = "File operation already in progress"
                Notify()
                return
            }
        }
        let admission = operations.Submit(
            OperationRequest{
                Kind: kind,
                Sources: sources,
                Destination: destination,
                Name: name,
                ClipboardVersion: clipboardVersion,
            }
        )
        if admission == OperationAdmission.Full || admission == OperationAdmission.Closed {
            Status = admission == OperationAdmission.Full ? "File operation queue is full": "File operation queue is closed"
            Notify()
            return
        }
        if TracksSources(kind) {
            for source in sources {
                movingSources.Add(source)
            }
        }
        operationCount++
        Status = "Working…"
        Notify()
        if admission == OperationAdmission.StartWorker {
            let owner = window
            let controller = this
            let queue = operations
            go browserOperationWorker(owner, controller, queue)
        }
    }

    internal func CompleteOperation(request OperationRequest, succeeded List[string], errors List[string]) {
        if disposed {
            return
        }
        if TracksSources(request.Kind) {
            for source in request.Sources {
                movingSources.Remove(source)
            }
        }
        operationCount--
        if request.Kind == OperationKind.Move && request.ClipboardVersion == clipboardGeneration {
            for source in succeeded {
                clipboardPaths.Remove(source)
            }
        }
        if succeeded.Count > 0 {
            if request.Kind == OperationKind.Rename {
                let source = succeeded[0]
                let destination = Path.Combine(Path.GetDirectoryName(source) ?? "", request.Name)
                RetargetSelection(First, source, destination)
                RetargetSelection(Second, source, destination)
                RefreshLoadedPanes(source, destination)
            } else {
                RefreshLoadedPanes()
            }
        }
        if errors.Count > 0 {
            Status = succeeded.Count.ToString() + " done, " + errors.Count.ToString()
            + " failed: " + errors[0]
            if closeRequested && closeFailure == "" {
                closeFailure = Status
            }
        } else if closeFailure == "" {
            Status = "Done"
        }
        Places.Refresh()
        if closeRequested && operationCount == 0 {
            if closeFailure != "" {
                closeRequested = false
                Status = closeFailure
                closeFailure = ""
            }
        }
        Notify()
    }

    internal func CompleteOpen(error string) {
        if disposed {
            return
        }
        Status = error
        Notify()
    }

    internal func CompleteTerminal(error string) {
        terminalOpening = false
        CompleteOpen(error)
    }

    private func TrashOperation(kind OperationKind) {
        if !AtTrashRoot {
            return
        }
        let sources = SelectedPaths()
        if sources.Count > 0 {
            StartOperation(kind, sources, "", "")
        }
    }

    private func TracksSources(kind OperationKind) bool -> kind == OperationKind.Move ||
        kind == OperationKind.Trash ||
        kind == OperationKind.Rename ||
        kind == OperationKind.Restore ||
        kind == OperationKind.Delete

    private func DropBlocked(destination string) bool -> Locations.IsRecent(destination) || InTrash(destination)

    private func RefreshLoadedPanes(source string = "", replacement string = "") {
        if First.DirectoryPath != "" {
            let selected = FocusedPath(First)
            NavigateTo(
                First.DirectoryPath,
                0,
                "refresh",
                First.HistoryIndex,
                selected == source ? replacement: selected
            )
        }
        if Second.DirectoryPath != "" {
            let selected = FocusedPath(Second)
            NavigateTo(
                Second.DirectoryPath,
                1,
                "refresh",
                Second.HistoryIndex,
                selected == source ? replacement: selected
            )
        }
    }

    private func RetargetSelection(pane BrowserPane, source string, destination string) {
        if pane.SelectedPaths.Remove(source) {
            pane.SelectedPaths.Add(destination)
        }
        if pane.SelectionAnchorPath == source {
            pane.SelectionAnchorPath = destination
        }
    }

    private func SelectionPath(pane BrowserPane) string {
        if pane.Selected < 0 || pane.Selected >= pane.VisibleEntries.Count {
            return ""
        }
        return pane.VisibleEntries[pane.Selected].FullPath
    }

    private func FocusedPath(pane BrowserPane) string {
        let selected = SelectionPath(pane)
        return selected == "" ? pane.PendingFocusPath: selected
    }

    internal func SelectedPaths() List[string] {
        let pane = ActivePane()
        let sources = List[string]()
        for entry in pane.VisibleEntries {
            if pane.SelectedPaths.Contains(entry.FullPath) {
                sources.Add(entry.FullPath)
            }
        }
        return sources
    }

    internal func FindPrefix(pane BrowserPane, prefix string, start int32) int32 {
        let count = pane.VisibleEntries.Count
        if count == 0 {
            return -1
        }
        let first = Math.Max(0, start) % count
        for offset in 0 ... count {
            let index = (first + offset) % count
            if pane.VisibleEntries[index].Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) {
                return index
            }
        }
        return -1
    }

    private func ResetTypeSelect() {
        resetTypeSelect()
    }

    private func Notify() {
        if !disposed {
            Places.Watch(ActivePane().DirectoryPath)
            changed()
        }
    }
}
