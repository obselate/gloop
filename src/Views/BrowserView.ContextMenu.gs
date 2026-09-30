package gloop

import Goo
import Goo.Widgets.Navigation
import System
import System.Collections.Generic

partial class BrowserView {
    private var contextMenuOpen bool
    private var contextMenuPoint Point

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
        contextMenuPoint = point
        contextMenuOpen = true
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
        let x = bounds.X + 12 + (tiles ? selected % columns * (FileTiles.TileWidth + FileTiles.Gap): 0)
        let y = bounds.Y + (tiles ? 12: 0) + row * rowHeight - viewport.ScrollOffset.Y + rowHeight / 2
        contextMenuPoint = Point{
            X: Math.Clamp(x, bounds.X, bounds.X + bounds.Width),
            Y: Math.Clamp(y, bounds.Y, bounds.Y + bounds.Height),
        }
        FocusFiles()
        contextMenuOpen = true
        Rebuild()
    }

    private func CloseContextMenu() {
        if !contextMenuOpen {
            return
        }
        contextMenuOpen = false
        Rebuild()
    }

    private func ContextMenu() Blob {
        let items = List[MenuItem]()
        let count = Model.SelectedCount()
        if chooser != nil {
            if count > 0 {
                items.Add(ContextMenuItem("Open", "Open", "open_in_new", count != 1))
                items.Add(MenuItem{Id: "open-separator", Separator: true})
            }
            items.Add(ContextMenuItem("NewFolder", "New folder", "create_new_folder"))
            items.Add(ContextMenuItem("Refresh", "Refresh", "refresh"))
            items.Add(
                ContextMenuItem("ToggleHidden", "Show hidden files", "visibility_off", false, settings.ShowHidden)
            )
        } else if count > 0 {
            items.Add(ContextMenuItem("Open", "Open", "open_in_new", count != 1))
            items.Add(MenuItem{Id: "open-separator", Separator: true})
            items.Add(ContextMenuItem("Cut", "Cut", "content_cut"))
            items.Add(ContextMenuItem("Copy", "Copy", "content_copy"))
            items.Add(ContextMenuItem("Paste", "Paste", "content_paste", !Model.HasClipboard))
            if count == 1 {
                items.Add(ContextMenuItem("Rename", "Rename", "edit"))
            }
            items.Add(MenuItem{Id: "trash-separator", Separator: true})
            items.Add(ContextMenuItem("Trash", "Move to Trash", "delete"))
        } else {
            let unavailable = Model.ActivePane().DirectoryPath == "" || Model.ActivePane().Error != ""
            items.Add(ContextMenuItem("NewFolder", "New folder", "create_new_folder", unavailable))
            items.Add(ContextMenuItem("Paste", "Paste", "content_paste", unavailable || !Model.HasClipboard))
            items.Add(MenuItem{Id: "folder-separator", Separator: true})
            items.Add(ContextMenuItem("OpenTerminal", "Open terminal", "terminal", unavailable))
            items.Add(ContextMenuItem("Refresh", "Refresh", "refresh"))
            items.Add(
                ContextMenuItem("ToggleHidden", "Show hidden files", "visibility_off", false, settings.ShowHidden)
            )
        }
        return Cell.Mount[FileContextMenuInput, FileContextMenu](
            "file-context-menu",
            FileContextMenuInput{
                Open: contextMenuOpen,
                Point: contextMenuPoint,
                Items: items.ToArray(),
                Palette: palette,
                OnDismiss: CloseContextMenu,
                OnActivate: action -> {
                    CloseContextMenu()
                    Host.Post(
                        () -> {
                            if chooser != nil && action == "Open" {
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
    ) MenuItem -> FileContextMenu.Item(action, label, icon, settings.Keybindings[action], palette, disabled, checked)
}
