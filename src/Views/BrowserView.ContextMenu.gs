package gloop

import Goo
import Goo.Widgets.Navigation
import System
import System.Collections.Generic

partial class BrowserView {
    private var contextMenuOpen bool
    private var contextMenuPoint Point
    private var contextMenuBookmark string = ""
    private var contextMenuPaths[]string = []string{}
    private var contextMenuColumns bool

    private func DismissContextMenuOnBlur(focused bool) {
        if !focused {
            CloseContextMenu()
        }
    }

    private func OpenBookmarkContextMenu(path string, point Point) {
        if dialog != "" || chooser != nil {
            return
        }
        contextMenuBookmark = path
        contextMenuPaths = []string{}
        contextMenuPoint = point
        contextMenuOpen = true
        Rebuild()
    }

    private func OpenBookmarkKeyboardContextMenu(path string, e KeyEvent, point Point) {
        let action = settings.ActionFor(
            e.Key.ToString(),
            e.Modifiers.Ctrl,
            e.Modifiers.Alt,
            e.Modifiers.Shift,
            e.Modifiers.Super
        )
        if chooser == nil && (action == "ContextMenu" || action == "ContextMenuAlternate") {
            e.PreventDefault()
            e.StopPropagation()
            OpenBookmarkContextMenu(path, point)
        }
    }

    private func OpenPathMenu(index int32, paths[]string, point Point) {
        if dialog != "" {
            return
        }
        Model.SetActive(index)
        contextMenuBookmark = ""
        contextMenuPaths = paths
        contextMenuPoint = point
        contextMenuOpen = true
        Rebuild()
    }

    private func OpenColumnMenu(index int32, point Point) {
        if dialog != "" {
            return
        }
        Model.SetActive(index)
        contextMenuBookmark = ""
        contextMenuPaths = []string{}
        contextMenuColumns = true
        contextMenuPoint = point
        contextMenuOpen = true
        Rebuild()
    }

    private func OpenContextMenu(index int32, row int32, point Point) {
        if dialog != "" {
            return
        }
        Model.SetActive(index)
        let pane = Model.ActivePane()
        if row < 0 {
            Model.ClearSelection()
        } else if row < pane.VisibleEntries.Count {
            if pane.SelectedPaths.Contains(pane.VisibleEntries[row].FullPath) {
                Model.MoveTo(row, true)
            } else {
                Model.Select(row)
            }
        }
        FocusFiles()
        contextMenuBookmark = ""
        contextMenuPaths = []string{}
        contextMenuPoint = point
        contextMenuOpen = true
        LoadApplications()
        Rebuild()
    }

    private func OpenKeyboardContextMenu() {
        let index = Model.ActiveIndex
        let pane = Model.ActivePane()
        if let entry = Model.SingleSelectedEntry() {
            Model.MoveTo(pane.VisibleEntries.IndexOf(entry), true)
        }
        let viewport = index == 0 ? firstList: secondList
        let bounds = viewport.ContentBox
        let tiles = settings.ViewMode == "tiles"
        let columns = tiles ? TileColumns(index): 1
        let selected = Math.Max(0, pane.Selected)
        let row = selected / columns
        let rowHeight = tiles ? FileTiles.TileHeight + FileTiles.Gap: FileTable.RowHeight
        let x = bounds.X + 12 + (tiles ? selected % columns * (TileWidth(index) + FileTiles.Gap): 0)
        let y = bounds.Y + (tiles ? 12: 0) + row * rowHeight - viewport.ScrollOffset.Y + rowHeight / 2
        contextMenuPoint = Point{
            X: Math.Clamp(x, bounds.X, bounds.X + bounds.Width),
            Y: Math.Clamp(y, bounds.Y, bounds.Y + bounds.Height),
        }
        FocusFiles()
        contextMenuBookmark = ""
        contextMenuPaths = []string{}
        contextMenuOpen = true
        LoadApplications()
        Rebuild()
    }

    private func CloseContextMenu() {
        if !contextMenuOpen {
            return
        }
        contextMenuOpen = false
        Selection.CancelApplications()
        contextMenuBookmark = ""
        contextMenuPaths = []string{}
        contextMenuColumns = false
        Rebuild()
    }

    private func ContextMenu() Blob {
        let items = List[MenuItem]()
        let count = Model.SelectedCount()
        if contextMenuColumns {
            items.Add(
                FileContextMenu.Item(
                    "ToggleTypeColumn",
                    "Type column",
                    "view_list",
                    "",
                    palette,
                    false,
                    settings.ShowTypeColumn
                )
            )
        } else if contextMenuPaths.Length > 0 {
            for path in contextMenuPaths {
                items.Add(FileContextMenu.Item("Navigate:" + path, FolderName(path), "folder", "", palette))
            }
        } else if contextMenuBookmark != "" {
            items.Add(FileContextMenu.Item("RemoveBookmark", "Remove bookmark", "bookmark_remove", "", palette))
        } else if chooser != nil {
            if count > 0 {
                items.Add(ContextMenuItem("Open", "Open", "open_in_new", count != 1))
                items.Add(ContextMenuItem("CopyPath", "Copy path", "link"))
                items.Add(ContextMenuItem("Properties", "Properties", "info"))
                items.Add(MenuItem{Id: "open-separator", Separator: true})
            }
            items.Add(ContextMenuItem("NewFolder", "New folder", "create_new_folder"))
            items.Add(ContextMenuItem("Refresh", "Refresh", "refresh"))
            items.Add(
                ContextMenuItem("ToggleHidden", "Show hidden files", "visibility_off", false, settings.ShowHidden)
            )
        } else if Model.InTrashView {
            let atRoot = Model.AtTrashRoot
            if count > 0 {
                items.Add(
                    ContextMenuItem("Open", "Open", "open_in_new", !(Model.SingleSelectedEntry()?.IsDirectory ?? false))
                )
                items.Add(ContextMenuItem("CopyPath", "Copy path", "link"))
                items.Add(MenuItem{Id: "open-separator", Separator: true})
                items.Add(ContextMenuItem("Restore", "Restore", "restore_from_trash", !atRoot))
                items.Add(ContextMenuItem("DeletePermanently", "Delete permanently", "delete_forever", !atRoot))
                items.Add(MenuItem{Id: "properties-separator", Separator: true})
                items.Add(ContextMenuItem("Properties", "Properties", "info"))
            } else {
                items.Add(
                    ContextMenuItem(
                        "EmptyTrash",
                        "Empty Trash",
                        "delete_forever",
                        !atRoot || Model.Places.TrashCount == 0
                    )
                )
                items.Add(MenuItem{Id: "trash-separator", Separator: true})
                items.Add(ContextMenuItem("CopyPath", "Copy path", "link"))
                items.Add(ContextMenuItem("Refresh", "Refresh", "refresh"))
                items.Add(
                    ContextMenuItem("ToggleHidden", "Show hidden files", "visibility_off", false, settings.ShowHidden)
                )
                items.Add(MenuItem{Id: "properties-separator", Separator: true})
                items.Add(ContextMenuItem("Properties", "Properties", "info"))
            }
        } else if count > 0 {
            SelectionMenuItems(items, count)
        } else {
            let unavailable = Model.ActivePane().DirectoryPath == "" || Model.ActivePane().Error != "" || Model.InRecent
            items.Add(ContextMenuItem("NewFolder", "New folder", "create_new_folder", unavailable))
            items.Add(ContextMenuItem("Paste", "Paste", "content_paste", unavailable || !Model.HasClipboard))
            items.Add(ContextMenuItem("CopyPath", "Copy path", "link", unavailable))
            items.Add(MenuItem{Id: "folder-separator", Separator: true})
            items.Add(ContextMenuItem("OpenTerminal", "Open terminal here", "terminal", unavailable))
            items.Add(ContextMenuItem("Refresh", "Refresh", "refresh"))
            items.Add(
                ContextMenuItem("ToggleHidden", "Show hidden files", "visibility_off", false, settings.ShowHidden)
            )
            items.Add(MenuItem{Id: "properties-separator", Separator: true})
            items.Add(ContextMenuItem("Properties", "Properties", "info", unavailable))
        }
        return Cell.Mount[FileContextMenuInput, FileContextMenu](
            "file-context-menu",
            FileContextMenuInput{
                Open: contextMenuOpen,
                Name: contextMenuBookmark == "" ? "File context menu": "Bookmark context menu",
                Point: contextMenuPoint,
                Items: items.ToArray(),
                Palette: palette,
                OnDismiss: CloseContextMenu,
                OnActivate: action -> {
                    let bookmark = contextMenuBookmark
                    CloseContextMenu()
                    Host.Post(
                        () -> {
                            if action == "RemoveBookmark" {
                                notice = settingsWriter?.RemoveBookmark(settings, bookmark) ?? ""
                                FocusFiles()
                                Rebuild()
                            } else if action.StartsWith("Navigate:", StringComparison.Ordinal) {
                                Model.Navigate(action.Substring(9))
                                FocusFiles()
                            } else if action.StartsWith("OpenWith:", StringComparison.Ordinal) {
                                LaunchApplication(action.Substring(9))
                            } else if chooser != nil && action == "Open" {
                                OpenBrowserSelection(true)
                            } else {
                                Invoke(action)
                            }
                        }
                    )
                },
            }
        )
    }

    private func ContextMenuItem(
        action string,
        label string,
        icon string,
        disabled bool = false,
        checked bool = false
    ) MenuItem -> FileContextMenu.Item(
        action,
        label,
        icon,
        settings.Keybindings.GetValueOrDefault(action, ""),
        palette,
        disabled,
        checked
    )
}
