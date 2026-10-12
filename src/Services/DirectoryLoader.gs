package gloop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.IO.Enumeration

class DirectoryLoader {
    private let window Window
    private let controller BrowserController
    private let settings AppSettings
    private let loads[]LatestWork
    private let views[]LatestWork

    internal init(window Window, controller BrowserController, settings AppSettings) {
        this.window = window
        this.controller = controller
        this.settings = settings
        loads = [2]LatestWork
        loads[0] = LatestWork()
        loads[1] = LatestWork()
        views = [2]LatestWork
        views[0] = LatestWork()
        views[1] = LatestWork()
    }

    internal func Close() {
        for queue in loads {
            queue.Close()
        }
        for queue in views {
            queue.Close()
        }
    }

    internal func NavigateTo(path string, index int32, mode string, historyIndex int32, selectedPath string) {
        if controller.IsDisposed || index < 0 || index > 1 {
            return
        }
        let pane = controller.Pane(index)
        var fullPath string
        try {
            fullPath = Locations.IsRecent(path) ? Locations.Recent: Path.GetFullPath(path)
        } catch (failure Exception) {
            pane.Error = failure.Message
            controller.Status = failure.Message
            controller.Notify()
            return
        }
        pane.LoadGeneration++
        pane.ViewGeneration++
        views[index].Cancel()
        if index == controller.ActiveIndex {
            controller.ResetTypeSelect()
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
            if index == controller.ActiveIndex {
                controller.Previews.QueuePreview()
            }
        }
        controller.Notify()
        let queue = loads[index]
        let request = DirectoryRequest{
            Index: index,
            Generation: pane.LoadGeneration,
            Path: fullPath,
            ShowHidden: settings.ShowHidden,
            Mode: mode,
            HistoryIndex: historyIndex,
            SelectedPath: selectedPath,
        }
        queue.Submit(
            generation -> Load(queue, generation, request),
            (_, failure) -> {
                let snapshot = DirectorySnapshot{DirectoryPath: request.Path, Error: failure.Message}
                try {
                    window.Post(
                        () -> ApplyDirectory(
                            request.Index,
                            request.Generation,
                            snapshot,
                            request.Mode,
                            request.HistoryIndex,
                            request.SelectedPath
                        )
                    )
                } catch (postFailure Exception) { }
            }
        )
    }

    internal func ApplyDirectory(
        index int32,
        generation int32,
        snapshot DirectorySnapshot,
        mode string,
        historyIndex int32,
        selectedPath string
    ) {
        if controller.IsDisposed {
            return
        }
        let pane = controller.Pane(index)
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
            if index == controller.ActiveIndex {
                controller.Previews.QueuePreview()
            }
            controller.Notify()
            return
        }
        pane.Entries = snapshot.Entries
        if mode != "refresh" {
            controller.Status = ""
        }
        RequestView(index, selectedPath)
    }

    internal func RequestView(index int32, selectedPath string) {
        let pane = controller.Pane(index)
        pane.ViewGeneration++
        if pane.Entries.Count == 0 {
            views[index].Cancel()
            pane.VisibleEntries = List[FileEntry]()
            pane.Selected = -1
            pane.SelectedPaths.Clear()
            pane.SelectionAnchorPath = ""
            pane.PendingFocusPath = ""
            pane.Loading = false
            if index == controller.ActiveIndex {
                controller.Previews.QueuePreview()
            }
            controller.Notify()
            pane.Refreshing = false
            return
        }
        pane.Loading = true
        let queue = views[index]
        let request = ViewRequest{
            Index: index,
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
                            request.Index,
                            request.Generation,
                            List[FileEntry](),
                            request.SelectedPath,
                            failure.Message
                        )
                    )
                } catch (postFailure Exception) { }
            }
        )
    }

    internal func ApplyView(index int32, generation int32, entries List[FileEntry], selectedPath string, error string) {
        if controller.IsDisposed {
            return
        }
        let pane = controller.Pane(index)
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
        if index == controller.ActiveIndex {
            controller.Previews.QueuePreview()
        }
        controller.Notify()
        pane.Refreshing = false
    }

    internal func RefreshLoadedPanes(source string = "", replacement string = "") {
        if controller.First.DirectoryPath != "" {
            let selected = controller.First.FocusedPath()
            NavigateTo(
                controller.First.DirectoryPath,
                0,
                "refresh",
                controller.First.HistoryIndex,
                selected == source ? replacement: selected
            )
        }
        if controller.Second.DirectoryPath != "" {
            let selected = controller.Second.FocusedPath()
            NavigateTo(
                controller.Second.DirectoryPath,
                1,
                "refresh",
                controller.Second.HistoryIndex,
                selected == source ? replacement: selected
            )
        }
    }

    private func Load(queue LatestWork, generation int32, request DirectoryRequest) {
        let snapshot = FileSystemService().List(request.Path, request.ShowHidden)
        if !queue.IsCurrent(generation) {
            return
        }
        try {
            window.Post(
                () -> ApplyDirectory(
                    request.Index,
                    request.Generation,
                    snapshot,
                    request.Mode,
                    request.HistoryIndex,
                    request.SelectedPath
                )
            )
        } catch (failure Exception) { }
    }

    private func BuildView(queue LatestWork, generation int32, request ViewRequest) {
        if !queue.IsCurrent(generation) {
            return
        }
        var visible = List[FileEntry]()
        var error = ""
        try {
            if request.Filter == "" && request.EntryFilter == nil {
                visible = FileSystemService().Sort(request.Entries, request.Column, request.Descending)
            } else {
                let wildcard = request.Filter.Contains('*') || request.Filter.Contains('?')
                var count = 0
                for entry in request.Entries {
                    if (count & 1023) == 0 && !queue.IsCurrent(generation) {
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
        } catch (failure Exception) {
            error = failure.Message
        }
        if !queue.IsCurrent(generation) {
            return
        }
        try {
            window.Post(() -> ApplyView(request.Index, request.Generation, visible, request.SelectedPath, error))
        } catch (failure Exception) { }
    }
}
