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

    private let settings AppSettings
    private let changed Action
    internal let Directories DirectoryLoader
    internal let Operations FileOperationQueue
    internal let Previews PreviewLoader
    internal let Archives ArchiveService = ArchiveService()
    private let resetTypeSelect Action
    private let clipboardPaths List[string]
    private var clipboardCut bool
    private var clipboardGeneration int32
    internal let Launches BrowserLaunchService
    private var disposed bool

    internal init(
        window Window,
        settings AppSettings,
        changed Action,
        resetTypeSelect Action,
        previewWidth int32,
        previewHeight int32
    ) {
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
        Launches = BrowserLaunchService(window, this)
        Places = PlacesService(
            window,
            error -> {
                if error != "" {
                    Status = error
                }

                changed()
            }
        )
    }

    internal func ActivePane() BrowserPane -> Pane(ActiveIndex)

    internal prop VisiblePaneCount int32 {
        get -> Split ? Math.Min(2, Panes.Count): 1
    }

    internal prop IsDisposed bool {
        get -> disposed
    }

    internal prop InRecent bool {
        get -> ActivePane().Kind == LocationKind.Recent
    }

    internal prop InTrashView bool {
        get -> ActivePane().Kind == LocationKind.Trash
    }

    internal prop AtTrashRoot bool {
        get -> ActivePane().AtTrashRoot
    }

    internal func CanRun(action string) bool {
        if ActivePane().Kind == LocationKind.Archive &&
            (
            action == "Rename" ||
                action == "Trash" ||
                action == "Cut" ||
                action == "Copy" ||
                action == "Paste" ||
                action == "NewFolder" ||
                action == "Compress" ||
                action == "Properties" ||
                action == "OpenTerminal" ||
                action == "OpenTerminalHere" ||
                action == "ToggleBookmark"
        ) {
            return false
        }

        if action == "Extract" || action == "Compress" {
            if InTrashView || InRecent || ActivePane().SelectedPaths.Count == 0 {
                return false
            }

            if action == "Extract" && ActivePane().Kind != LocationKind.Archive {
                for source in ActivePane().SelectionPaths() {
                    if !ArchiveService.Supported(source) {
                        return false
                    }
                }
            }
        }

        if InTrashView {
            if action == "NewFolder" || action == "Rename" || action == "Copy"
            || action == "Cut" || action == "Paste" || action == "Trash" {
                return false
            }

            if action == "Open" {
                return ActivePane().SingleSelectedEntry()?.IsDirectory ?? false
            }

            if action == "Restore" || action == "DeletePermanently" {
                return AtTrashRoot
            }

            if action == "EmptyTrash" {
                return AtTrashRoot && Places.TrashCount > 0
            }

            return true
        }

        if InRecent &&
            (
            action == "NewFolder" || action == "Paste" || action == "ToggleBookmark"
            || action == "OpenTerminalHere"
            || (action == "OpenTerminal" && !(ActivePane().SingleSelectedEntry()?.IsDirectory ?? false))
        ) {
            return false
        }

        let empty = ActivePane().SelectedPaths.Count == 0

        if InRecent {
            return !empty || (action != "CopyPath" && action != "Properties")
        }

        if ActivePane().DirectoryPath == "" || ActivePane().Error != "" {
            return action != "OpenTerminal" &&
                action != "OpenTerminalHere" &&
                (
                !empty || (action != "NewFolder" && action != "Paste" && action != "CopyPath" && action != "Properties")
            )
        }

        return true
    }

    internal func Pane(index int32) BrowserPane -> Panes[index]

    internal func Start(path string, selectedPath string = "") {
        for pane in Panes {
            Directories.NavigateTo(path, pane, DirectoryMode.Push, -1, pane == ActivePane() ? selectedPath: "")
        }
    }

    internal func Navigate(path string, paneIndex int32 = -1) {
        let index = if paneIndex < 0 {
            ActiveIndex
        } else {
            paneIndex
        }

        Directories.NavigateTo(path, Pane(index), DirectoryMode.Push, -1, "")
    }

    internal func Back() {
        let pane = ActivePane()

        if pane.CanBack() {
            Directories.NavigateTo(
                pane.History[pane.HistoryIndex - 1],
                pane,
                DirectoryMode.History,
                pane.HistoryIndex - 1,
                pane.DirectoryPath
            )
        }
    }

    internal func Forward() {
        let pane = ActivePane()

        if pane.CanForward() {
            Directories.NavigateTo(
                pane.History[pane.HistoryIndex + 1],
                pane,
                DirectoryMode.History,
                pane.HistoryIndex + 1,
                ""
            )
        }
    }

    internal func Parent() {
        let path = ActivePane().DirectoryPath

        if path == "" {
            return
        }

        if InRecent {
            Navigate(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile))
            return
        }

        let parent = Path.GetDirectoryName(path)

        if parent != nil && parent != path {
            Directories.NavigateTo(parent, ActivePane(), DirectoryMode.Push, -1, path)
        }
    }

    internal func ShowInFolder() {
        guard let entry = ActivePane().SingleSelectedEntry() else {
            return
        }

        if let directory = Path.GetDirectoryName(entry.FullPath) {
            Directories.NavigateTo(directory, ActivePane(), DirectoryMode.Push, -1, entry.FullPath)
        }
    }

    internal func LeaveMount(mountPath string) {
        let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)

        for pane in Panes {
            let path = pane.DirectoryPath

            if path == mountPath || path.StartsWith(mountPath.TrimEnd('/') + "/", StringComparison.Ordinal) {
                Directories.NavigateTo(home, pane, DirectoryMode.Push, -1, "")
            }
        }
    }

    internal func Refresh() {
        ResetTypeSelect()
        Places.Refresh()

        let pane = ActivePane()

        if pane.DirectoryPath != "" {
            Previews.RequestReload()
            Directories.NavigateTo(
                pane.DirectoryPath,
                pane,
                DirectoryMode.Refresh,
                pane.HistoryIndex,
                pane.FocusedPath()
            )
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

    internal func ToggleHidden() {
        settings.ShowHidden = !settings.ShowHidden
        settings.LaunchShowHiddenOriginal = nil

        Directories.RefreshLoadedPanes()
        Notify()
    }

    internal func SetViewMode(mode ViewMode) {
        if (mode != ViewMode.List && mode != ViewMode.Tiles) || settings.ViewMode == mode {
            return
        }

        settings.ViewMode = mode

        Notify()
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
                Directories.NavigateTo(ActivePane().DirectoryPath, pane, DirectoryMode.Push, -1, "")
            } else if pane.DirectoryPath != "" {
                Directories.NavigateTo(
                    pane.DirectoryPath,
                    pane,
                    DirectoryMode.Refresh,
                    pane.HistoryIndex,
                    pane.FocusedPath()
                )
            }

            Directories.WatchPane(pane)
        } else {
            ActiveIndex = 0
            Directories.StopWatch(Panes[1])
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

    internal func Sort(column SortColumn) {
        if column != SortColumn.Name &&
            column != SortColumn.Size &&
            column != SortColumn.Modified &&
            column != SortColumn.Kind {
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

        if clipboardPaths.Count == 0 || destination == "" || ActivePane().Kind != LocationKind.Folder {
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
        Pane(paneIndex).Kind != LocationKind.Trash && Pane(paneIndex).Kind != LocationKind.Archive

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

    internal func Extract(destination string) {
        var folder = ActivePane().DirectoryPath

        if ActivePane().Kind == LocationKind.Archive {
            folder = Path.GetDirectoryName(Archives.Source(folder)) ?? folder
        }

        try {
            if destination.StartsWith('~') {
                throw ArgumentException("Use a folder path without '~'")
            }

            Operations.StartOperation(
                OperationKind.Extract,
                ActivePane().SelectionPaths(),
                Path.GetFullPath(destination, folder),
                ""
            )
        } catch (failure ArgumentException) {
            Status = "Extract failed for " + destination + ": " + failure.Message
            Notify()
        }
    }

    internal func Compress(name string) {
        Operations.StartOperation(
            OperationKind.Compress,
            ActivePane().SelectionPaths(),
            ActivePane().DirectoryPath,
            name
        )
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
        Archives.Close()
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

    private func TrashOperation(kind OperationKind) {
        if !AtTrashRoot {
            return
        }

        let sources = ActivePane().SelectionPaths()

        if sources.Count > 0 {
            Operations.StartOperation(kind, sources, "", "")
        }
    }

    private func DropBlocked(destination string) bool ->
    Archives.Source(destination) != "" || Locations.Resolve(
        destination,
        TrashDirectory,
        out var fullPath,
        out var atTrashRoot
    ) != LocationKind.Folder

    internal func ResetTypeSelect() {
        resetTypeSelect()
    }

    internal func Notify() {
        if !disposed {
            Places.Watch(ActivePane().DirectoryPath, ActivePane().Kind)
            changed()
        }
    }
}
