package gloop

import Goo
import Goo.Widgets.Navigation
import System
import System.Collections.Generic

partial class BrowserView {
    private var selectionInfo SelectionInfoService?
    private var contextApplications List[AppChoice] = List[AppChoice]()
    private var contextApplicationsReady bool

    private prop Selection SelectionInfoService {
        get {
            guard let value = selectionInfo else {
                throw InvalidOperationException("Selection info is not attached")
            }
            return value
        }
    }

    private func SelectionMenuItems(items List[MenuItem], count int32) {
        let recent = Model.InRecent
        items.Add(ContextMenuItem("Open", "Open", "open_in_new", count != 1))
        items.Add(OpenWithItem(count))
        if recent {
            items.Add(ContextMenuItem("ShowInFolder", "Show in folder", "folder_open", count != 1))
        }
        items.Add(MenuItem{Id: "open-separator", Separator: true})
        items.Add(ContextMenuItem("Cut", "Cut", "content_cut"))
        items.Add(ContextMenuItem("Copy", "Copy", "content_copy"))
        items.Add(ContextMenuItem("Paste", "Paste", "content_paste", !Model.HasClipboard))
        items.Add(ContextMenuItem("CopyPath", "Copy path", "link"))
        items.Add(MenuItem{Id: "copy-separator", Separator: true})
        if count == 1 {
            items.Add(ContextMenuItem("Rename", "Rename", "edit"))
        }
        items.Add(ContextMenuItem("Trash", "Move to Trash", "delete"))
        items.Add(MenuItem{Id: "trash-separator", Separator: true})
        items.Add(ContextMenuItem("OpenTerminal", "Open terminal here", "terminal"))
        items.Add(ContextMenuItem("Properties", "Properties", "info"))
    }

    private func OpenWithItem(count int32) MenuItem {
        let ready = count == 1 && contextApplicationsReady && contextApplications.Count > 0
        var item = FileContextMenu.Item("OpenWith", "Open with", "apps", "", palette, !ready)
        if ready {
            let children = List[MenuItem]()
            for choice in contextApplications {
                children.Add(
                    FileContextMenu.Item(
                        "OpenWith:" + choice.Id,
                        choice.Name,
                        "",
                        choice.Default ? "Default": "",
                        palette
                    )
                )
            }
            item.Children = children.ToArray()
        }
        return item
    }

    private func LoadApplications() {
        Selection.CancelApplications()
        contextApplications = List[AppChoice]()
        contextApplicationsReady = false
        if chooser != nil || Model.InTrashView {
            return
        }
        guard let entry = Model.SingleSelectedEntry() else {
            return
        }
        Selection.LoadApplications(
            entry.FullPath,
            (choices, error) -> {
                contextApplications = choices
                contextApplicationsReady = true
                if error != "" {
                    notice = error
                }
                Rebuild()
            }
        )
    }

    private func LaunchApplication(id string) {
        let paths = Model.SelectedPaths()
        if paths.Count == 0 {
            return
        }
        Selection.Launch(
            id,
            paths,
            error -> {
                if error != "" {
                    notice = error
                    Rebuild()
                }
            }
        )
    }

    private func CopyPaths() {
        let paths = Model.SelectedPaths()
        if paths.Count == 0 && !Model.InRecent && Model.ActivePane().DirectoryPath != "" {
            paths.Add(Model.ActivePane().DirectoryPath)
        }
        if paths.Count == 0 {
            return
        }
        Host.SetClipboardText(String.Join("\n", paths))
        notice = paths.Count == 1 ? "Copied 1 path": "Copied " + paths.Count.ToString() + " paths"
    }
}
