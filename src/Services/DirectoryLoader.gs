package gloop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.IO.Enumeration

class DirectoryLoader {
    private const CancellationCheckMask int32 = 1023

    private let window Window
    private let controller BrowserController
    private let settings AppSettings
    private let loads Dictionary[BrowserPane, LatestWork] = Dictionary[BrowserPane, LatestWork]()
    private let views Dictionary[BrowserPane, LatestWork] = Dictionary[BrowserPane, LatestWork]()

    internal init(window Window, controller BrowserController, settings AppSettings) {
        this.window = window
        this.controller = controller
        this.settings = settings
        for pane in controller.Panes {
            AddPane(pane)
        }
    }

    internal func Close() {
        for queue in loads.Values {
            queue.Close()
        }
        for queue in views.Values {
            queue.Close()
        }
    }

    internal func AddPane(pane BrowserPane) {
        loads.Add(pane, LatestWork())
        views.Add(pane, LatestWork())
    }

    internal func NavigateTo(
        path string,
        pane BrowserPane,
        mode DirectoryMode,
        historyIndex int32,
        selectedPath string
    ) {
        if controller.IsDisposed || !controller.Panes.Contains(pane) {
            return
        }
        var fullPath string
        var kind LocationKind
        var atTrashRoot bool
        try {
            kind = Locations.Resolve(path, controller.TrashDirectory, out fullPath, out atTrashRoot)
        } catch (failure ArgumentException) {
            pane.Error = "Open folder failed for " + path + ": " + failure.Message
            controller.Status = pane.Error
            controller.Notify()
            return
        }
        pane.LoadGeneration++
        pane.ViewGeneration++
        views[pane].Cancel()
        if pane == controller.ActivePane() && mode != DirectoryMode.Refresh {
            controller.ResetTypeSelect()
        }
        pane.DirectoryPath = fullPath
        pane.Kind = kind
        pane.AtTrashRoot = atTrashRoot
        pane.PendingFocusPath = selectedPath
        pane.Loading = true
        pane.Error = ""
        pane.Refreshing = mode == DirectoryMode.Refresh
        if !pane.Refreshing {
            pane.Entries = List[FileEntry]()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.SelectionAnchorPath = ""
            if pane == controller.ActivePane() {
                controller.Previews.QueuePreview()
            }
        }
        controller.Notify()
        let queue = loads[pane]
        let request = DirectoryRequest{
            Pane: pane,
            Generation: pane.LoadGeneration,
            Path: fullPath,
            Kind: kind,
            AtTrashRoot: atTrashRoot,
            ShowHidden: settings.ShowHidden,
            Mode: mode,
            HistoryIndex: historyIndex,
            SelectedPath: selectedPath,
        }
        queue.Submit(
            generation -> Load(queue, generation, request),
            (_, failure) -> {
                let snapshot = DirectorySnapshot{
                    DirectoryPath: request.Path,
                    Error: "List folder failed for " + request.Path + ": " + failure.Message
                }
                try {
                    window.Post(
                        () -> ApplyDirectory(
                            request.Pane,
                            request.Generation,
                            snapshot,
                            request.Mode,
                            request.HistoryIndex,
                            request.SelectedPath
                        )
                    )
                } catch (postFailure InvalidOperationException) { }
            }
        )
    }

    internal func ApplyDirectory(
        pane BrowserPane,
        generation int32,
        snapshot DirectorySnapshot,
        mode DirectoryMode,
        historyIndex int32,
        selectedPath string
    ) {
        if controller.IsDisposed || !controller.Panes.Contains(pane) {
            return
        }
        if generation != pane.LoadGeneration {
            return
        }
        pane.DirectoryPath = snapshot.DirectoryPath
        pane.UpdateHistory(snapshot.DirectoryPath, mode, historyIndex)
        if snapshot.Error != "" {
            pane.Loading = false
            pane.Refreshing = false
            pane.PendingFocusPath = ""
            pane.Entries = List[FileEntry]()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.Error = snapshot.Error
            controller.Status = snapshot.Error
            if pane == controller.ActivePane() {
                controller.Previews.QueuePreview()
            }
            controller.Notify()
            return
        }
        pane.Entries = snapshot.Entries
        if mode != DirectoryMode.Refresh {
            controller.Status = ""
        }
        RequestView(pane, selectedPath)
    }

    internal func RequestView(pane BrowserPane, selectedPath string) {
        if controller.IsDisposed || !controller.Panes.Contains(pane) {
            return
        }
        pane.ViewGeneration++
        if pane.Entries.Count == 0 {
            views[pane].Cancel()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.SelectionAnchorPath = ""
            pane.PendingFocusPath = ""
            pane.Loading = false
            if pane == controller.ActivePane() {
                controller.Previews.QueuePreview()
            }
            controller.Notify()
            pane.Refreshing = false
            return
        }
        pane.Loading = true
        let queue = views[pane]
        let request = ViewRequest{
            Pane: pane,
            Generation: pane.ViewGeneration,
            Entries: pane.Entries,
            Filter: pane.Filter,
            EntryFilter: controller.EntryFilter,
            Column: pane.SortColumn,
            Descending: pane.Descending,
            SelectedPath: selectedPath,
        }
        queue.Submit(
            generation -> BuildView(queue, generation, request),
            (_, failure) -> {
                try {
                    window.Post(
                        () -> ApplyView(
                            request.Pane,
                            request.Generation,
                            List[FileEntry](),
                            request.SelectedPath,
                            "Build folder view failed for " + request.Pane.DirectoryPath + ": " + failure.Message
                        )
                    )
                } catch (postFailure InvalidOperationException) { }
            }
        )
    }

    internal func ApplyView(
        pane BrowserPane,
        generation int32,
        entries List[FileEntry],
        selectedPath string,
        error string
    ) {
        if controller.IsDisposed || !controller.Panes.Contains(pane) {
            return
        }
        if generation != pane.ViewGeneration {
            return
        }

        pane.Loading = false
        pane.Error = error
        if error == "" && pane.Filter == "" && controller.EntryFilter == nil {
            pane.Entries = entries
        }
        pane.ReconcileSelection(entries, selectedPath, controller.SelectFirstEntry)
        if error != "" {
            controller.Status = error
        }
        if pane == controller.ActivePane() {
            controller.Previews.QueuePreview()
        }
        controller.Notify()
        pane.Refreshing = false
    }

    internal func RefreshLoadedPanes(source string = "", replacement string = "") {
        for pane in controller.Panes {
            if pane.DirectoryPath != "" {
                let selected = pane.FocusedPath()
                NavigateTo(
                    pane.DirectoryPath,
                    pane,
                    DirectoryMode.Refresh,
                    pane.HistoryIndex,
                    selected == source ? replacement: selected
                )
            }
        }
    }

    private func Load(queue LatestWork, generation int32, request DirectoryRequest) {
        let snapshot = FileSystemService().List(request.Path, request.Kind, request.AtTrashRoot, request.ShowHidden)
        if !queue.IsCurrent(generation) {
            return
        }
        try {
            window.Post(
                () -> ApplyDirectory(
                    request.Pane,
                    request.Generation,
                    snapshot,
                    request.Mode,
                    request.HistoryIndex,
                    request.SelectedPath
                )
            )
        } catch (failure InvalidOperationException) { }
    }

    private func BuildView(queue LatestWork, generation int32, request ViewRequest) {
        if !queue.IsCurrent(generation) {
            return
        }
        var visible = List[FileEntry]()
        if request.Filter == "" && request.EntryFilter == nil {
            visible = FileSystemService().Sort(request.Entries, request.Column, request.Descending)
        } else {
            let wildcard = request.Filter.Contains('*') || request.Filter.Contains('?')
            var count = 0
            for entry in request.Entries {
                if (count & CancellationCheckMask) == 0 && !queue.IsCurrent(generation) {
                    break
                }
                count++
                if let entryFilter = request.EntryFilter {
                    if !entryFilter(entry) {
                        continue
                    }
                }
                let matches = if wildcard {
                    FileSystemName.MatchesSimpleExpression(request.Filter.AsSpan(), entry.Name.AsSpan(), true)
                } else {
                    entry.Name.Contains(request.Filter, StringComparison.OrdinalIgnoreCase)
                }
                if matches {
                    visible.Add(entry)
                }
            }
            if queue.IsCurrent(generation) {
                FileSystemService().SortInPlace(visible, request.Column, request.Descending)
            }
        }
        if !queue.IsCurrent(generation) {
            return
        }
        try {
            window.Post(() -> ApplyView(request.Pane, request.Generation, visible, request.SelectedPath, ""))
        } catch (failure InvalidOperationException) { }
    }
}
