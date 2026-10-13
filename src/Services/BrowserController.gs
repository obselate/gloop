package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

class BrowserController {
    internal let Panes List[BrowserPane] = List[BrowserPane]()
    internal var ActiveIndex int32
    internal var Split bool
    internal var PreviewVisible bool
    internal var Status string
    internal var SelectFirstEntry bool = true
    internal var EntryFilter Func[FileEntry, bool]?
    internal let Places PlacesService
    internal let TrashDirectory string = TrashService().FilesDirectory()

    private let window Window
    private let settings AppSettings
    private let changed Action
    internal let Directories DirectoryLoader
    internal let Operations FileOperationQueue
    internal let Previews PreviewLoader
    private let resetTypeSelect Action
    private let clipboardPaths List[string]
    private var clipboardCut bool
    private var clipboardGeneration int32
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
        Panes.Add(BrowserPane())
        if settings.SplitView {
            Panes.Add(BrowserPane())
        }
        ActiveIndex = 0
        Split = settings.SplitView
        PreviewVisible = settings.ShowPreview
        Status = ""
        clipboardPaths = List[string]()
        Directories = DirectoryLoader(window, this, settings)
        Operations = FileOperationQueue(window, this)
        Previews = PreviewLoader(window, this, previewWidth, previewHeight)
        Places = PlacesService(window, changed)
    }

    internal func ActivePane() BrowserPane -> Pane(ActiveIndex)

    internal prop VisiblePaneCount int32 {
        get -> Split ? Math.Min(2, Panes.Count): 1
    }

    internal prop IsDisposed bool {
        get -> disposed
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

    internal func CanRun(action string, menu bool = false) bool {
        if InTrashView {
            if action == "NewFolder" || action == "Rename" || action == "Copy"
            || action == "Cut" || action == "Paste" || action == "Trash" {
                return false
            }
            if menu {
                if action == "Open" {
                    return ActivePane().SingleSelectedEntry()?.IsDirectory ?? false
                }
                if action == "Restore" || action == "DeletePermanently" {
                    return AtTrashRoot
                }
                if action == "EmptyTrash" {
                    return AtTrashRoot && Places.TrashCount > 0
                }
            }
            return true
        }
        if InRecent &&
            (
            action == "NewFolder" || action == "Paste" || action == "ToggleBookmark"
            || (action == "OpenTerminal" && !(ActivePane().SingleSelectedEntry()?.IsDirectory ?? false))
        ) {
            return false
        }
        if !menu {
            return true
        }
        let empty = ActivePane().SelectedPaths.Count == 0
        if InRecent {
            return !empty || (action != "CopyPath" && action != "Properties")
        }
        if ActivePane().DirectoryPath == "" || ActivePane().Error != "" {
            return action != "OpenTerminal" &&
                (
                !empty || (action != "NewFolder" && action != "Paste" && action != "CopyPath" && action != "Properties")
            )
        }
        return true
    }

    internal func Pane(index int32) BrowserPane -> Panes[index]

    internal func Start(path string, selectedPath string = "") {
        for pane in Panes {
            Directories.NavigateTo(path, pane, "push", -1, pane == ActivePane() ? selectedPath: "")
        }
    }

    internal func Navigate(path string, paneIndex int32 = -1) {
        let index = if paneIndex < 0 {
            ActiveIndex
        } else {
            paneIndex
        }
        Directories.NavigateTo(path, Pane(index), "push", -1, "")
    }

    internal func Back() {
        let pane = ActivePane()
        if pane.CanBack() {
            Directories.NavigateTo(
                pane.History[pane.HistoryIndex - 1],
                pane,
                "history",
                pane.HistoryIndex - 1,
                pane.DirectoryPath
            )
        }
    }

    internal func Forward() {
        let pane = ActivePane()
        if pane.CanForward() {
            Directories.NavigateTo(pane.History[pane.HistoryIndex + 1], pane, "history", pane.HistoryIndex + 1, "")
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
            Directories.NavigateTo(parent, ActivePane(), "push", -1, path)
        }
    }

    internal func ShowInFolder() {
        guard let entry = ActivePane().SingleSelectedEntry() else {
            return
        }
        if let directory = Path.GetDirectoryName(entry.FullPath) {
            Directories.NavigateTo(directory, ActivePane(), "push", -1, entry.FullPath)
        }
    }

    internal func LeaveMount(mountPath string) {
        let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        for pane in Panes {
            let path = pane.DirectoryPath
            if path == mountPath || path.StartsWith(mountPath.TrimEnd('/') + "/", StringComparison.Ordinal) {
                Directories.NavigateTo(home, pane, "push", -1, "")
            }
        }
    }

    internal func Refresh() {
        Places.Refresh()
        let pane = ActivePane()
        if pane.DirectoryPath != "" {
            Directories.NavigateTo(pane.DirectoryPath, pane, "refresh", pane.HistoryIndex, pane.FocusedPath())
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
        let previous = pane.Selected
        if !pane.SelectIndex(index, ctrl, shift, focusOnly) {
            return
        }
        if previous != pane.Selected {
            Previews.QueuePreview()
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
        let previous = pane.Selected
        if !pane.SelectAll() {
            return
        }
        if previous < 0 {
            Previews.QueuePreview()
        }
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
        if ActivePane().ClearSelection() {
            Notify()
        }
    }

    internal func OpenSelected() {
        ResetTypeSelect()
        guard let entry = ActivePane().SelectedEntry() else {
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
        Directories.RefreshLoadedPanes()
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
            if let entry = ActivePane().SingleSelectedEntry() {
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
        Previews.QueuePreview()
        Notify()
    }

    internal func ToggleSplit() {
        ResetTypeSelect()
        Split = !Split
        settings.SplitView = Split
        if Split {
            if Panes.Count < 2 {
                let pane = BrowserPane()
                Panes.Add(pane)
                Directories.AddPane(pane)
            }
            let pane = Panes[1]
            if pane.DirectoryPath == "" && ActivePane().DirectoryPath != "" {
                Directories.NavigateTo(ActivePane().DirectoryPath, pane, "push", -1, "")
            }
        } else {
            ActiveIndex = 0
        }
        Previews.QueuePreview()
        Notify()
    }

    internal func SwitchPane() {
        if Split {
            SetActive((ActiveIndex + 1) % VisiblePaneCount)
        }
    }

    internal func SetActive(index int32) {
        if index < 0 || index >= VisiblePaneCount || index == ActiveIndex {
            return
        }
        ActiveIndex = index
        ResetTypeSelect()
        Previews.QueuePreview()
        Notify()
    }

    internal func SetEntryFilter(value Func[FileEntry, bool]?) {
        EntryFilter = value
        for pane in Panes {
            if pane.Entries.Count > 0 {
                Directories.RequestView(pane, pane.SelectionPath())
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
        Directories.RequestView(pane, pane.SelectionPath())
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
        Directories.RequestView(pane, pane.SelectionPath())
        Notify()
    }

    internal func Copy(cut bool = false) {
        let sources = ActivePane().SelectionPaths()
        if sources.Count == 0 {
            return
        }
        clipboardPaths.Clear()
        for source in sources {
            clipboardPaths.Add(source)
        }
        clipboardCut = cut
        clipboardGeneration++
        Status = (cut ? "Cut ": "Copied ") + ActivePane().SelectionSummary()
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
        Operations.StartOperation(
            clipboardCut ? OperationKind.Move: OperationKind.Copy,
            List[string](clipboardPaths),
            destination,
            "",
            clipboardGeneration
        )
    }

    internal func CanDrag(paneIndex int32) bool -> Operations.AcceptingOperations &&
        paneIndex >= 0 &&
        paneIndex < VisiblePaneCount &&
        !InTrash(Pane(paneIndex).DirectoryPath)

    internal func CanDrop(destination string) bool -> Operations.AcceptingOperations && !DropBlocked(destination)

    internal func QueueFileDrop(sources List[string], destination string, copy bool) {
        if CanDrop(destination) && sources.Count > 0 {
            Operations.StartOperation(copy ? OperationKind.Copy: OperationKind.Move, sources, destination, "")
        }
    }

    internal func DragTooLarge() {
        Status = "Selection is too large to drag into another app"
        Notify()
    }

    internal func CreateFolder(name string) {
        let directory = ActivePane().DirectoryPath
        if directory != "" {
            Operations.StartOperation(OperationKind.CreateFolder, directory, "", name)
        }
    }

    internal func Rename(name string) {
        guard let entry = ActivePane().SingleSelectedEntry() else {
            return
        }
        Operations.StartOperation(OperationKind.Rename, entry.FullPath, "", name)
    }

    internal func Trash() {
        let sources = ActivePane().SelectionPaths()
        if sources.Count == 0 {
            return
        }
        Operations.StartOperation(OperationKind.Trash, sources, "", "")
    }

    internal func Restore() {
        TrashOperation(OperationKind.Restore)
    }

    internal func DeletePermanently() {
        TrashOperation(OperationKind.Delete)
    }

    internal func EmptyTrash() {
        if AtTrashRoot {
            Operations.StartOperation(OperationKind.Empty, TrashDirectory, "", "")
        }
    }

    internal func Dispose() {
        if disposed {
            return
        }
        disposed = true
        Places.Dispose()
        Directories.Close()
        Operations.Close()
        Previews.Close()
    }

    internal func CompleteClipboardMove(request OperationRequest, results List[OperationResult]) {
        if request.Kind == OperationKind.Move && request.ClipboardVersion == clipboardGeneration {
            for result in results {
                if result.Error == "" {
                    clipboardPaths.Remove(result.Source)
                }
            }
        }
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
        let sources = ActivePane().SelectionPaths()
        if sources.Count > 0 {
            Operations.StartOperation(kind, sources, "", "")
        }
    }

    private func DropBlocked(destination string) bool -> Locations.IsRecent(destination) || InTrash(destination)

    internal func ResetTypeSelect() {
        resetTypeSelect()
    }

    internal func Notify() {
        if !disposed {
            Places.Watch(ActivePane().DirectoryPath)
            changed()
        }
    }
}

func browserOpen(window Window, controller BrowserController, path string) {
    var error string
    try {
        error = FileSystemService().Open(path)
    } catch (failure Exception) {
        error = failure.Message
    }
    try {
        window.Post(() -> controller.CompleteOpen(error))
    } catch (failure Exception) { }
}

func browserOpenTerminal(window Window, controller BrowserController, directory string) {
    let error = TerminalService().Open(directory)
    try {
        window.Post(() -> controller.CompleteTerminal(error))
    } catch (failure Exception) { }
}
