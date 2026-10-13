package gloop

import Goo
import System
import System.Collections.Generic

partial class BrowserView {
    private func HandleKey(e KeyEvent) {
        if e.IsComposing && !e.Modifiers.Ctrl && !e.Modifiers.Alt && !e.Modifiers.Super {
            return
        }
        let action = settings.ActionFor(
            e.Key.ToString(),
            e.Modifiers.Ctrl,
            e.Modifiers.Alt,
            e.Modifiers.Shift,
            e.Modifiers.Super
        )
        if contextMenuOpen {
            if action == "Dismiss" {
                CloseContextMenu()
                e.PreventDefault()
                e.StopPropagation()
            }
            return
        }
        if action == "" {
            return
        }
        if dialog == "Preferences" && Host.PlatformInput.Editor?.IsReadOnly == false
        && !e.Modifiers.Ctrl && !e.Modifiers.Alt && !e.Modifiers.Super
        && e.Key.ToString() != "Tab" && e.Key.ToString() != "Escape" {
            return
        }
        if dialog != "" {
            if action == "Dismiss" {
                CloseDialog()
            } else if action == "Quit" {
                Host.RequestClose()
            } else if action == "FocusNext" {
                Host.PlatformInput.MoveFocus(true)
            } else if action == "FocusPrevious" {
                Host.PlatformInput.MoveFocus(false)
            } else if action == "Open" && dialog == "Move to Trash" {
                SubmitDialog()
            } else {
                return
            }
        } else {
            let editor = Host.PlatformInput.Editor
            let previewFocused = editor?.IsReadOnly == true
            if editor != nil && !previewFocused && action != "Dismiss" && action != "Quit" && action != "FocusLocation"
            && action != "FocusFilter" && action != "FocusNext" && action != "FocusPrevious"
            && action != "OpenTerminal" {
                return
            }
            if previewFocused &&
                (
                action == "Copy" || action == "Cut" || action == "Paste" || action == "Trash"
                || action == "SelectAll" || action == "ToggleSelection"
            ) {
                return
            }
            if IsMovement(action) || action == "Open" {
                return
            }
            let plain = !e.Modifiers.Ctrl && !e.Modifiers.Alt && !e.Modifiers.Super
            if !previewFocused && action == "TogglePreview" && plain {
                return
            }
            Invoke(action)
        }
        e.PreventDefault()
        e.StopPropagation()
    }

    private func Invoke(action string) {
        if !(chooser?.Allows(action) ?? true) || !Model.CanRun(action) {
            return
        }
        notice = ""
        switch action {
            case "Open" {
                OpenBrowserSelection()
            }
            case "ContextMenu" or "ContextMenuAlternate" {
                OpenKeyboardContextMenu()
            }
            case "Parent" {
                Model.Parent()
            }
            case "Back" {
                Model.Back()
            }
            case "Forward" {
                Model.Forward()
            }
            case "Refresh" {
                Model.Refresh()
            }
            case "FocusLocation" {
                EditLocation()
            }
            case "FocusFilter" {
                if Model.Split || BrowsingWidth() < 560 {
                    OpenDialog("Filter files", Model.ActivePane().Filter)
                } else {
                    filterHandle.Focus()
                }
            }
            case "FocusNext" {
                Host.PlatformInput.MoveFocus(true)
            }
            case "FocusPrevious" {
                Host.PlatformInput.MoveFocus(false)
            }
            case "NextPane" {
                Model.SwitchPane()
                FocusFiles()
            }
            case "TogglePreview" {
                Model.TogglePreview()
                SavePreferences()
                if !Model.PreviewVisible {
                    FocusFiles()
                }
            }
            case "ToggleSplit" {
                Model.ToggleSplit()
                SavePreferences()
                FocusFiles()
            }
            case "ToggleHidden" {
                Model.ToggleHidden()
                SavePreferences()
            }
            case "ToggleTypeColumn" {
                settings.ShowTypeColumn = !settings.ShowTypeColumn
                SavePreferences()
            }
            case "ViewList" or "ViewTiles" {
                Model.SetViewMode(
                    if action == "ViewTiles" {
                        "tiles"
                    } else {
                        "list"
                    }
                )
                SavePreferences()
                FocusFiles()
                let state = paneViews[Model.ActiveIndex]
                state.RevealPending = true
                Host.Post(() -> RevealSelection(state))
            }
            case "OpenTerminal" {
                Model.OpenTerminal()
            }
            case "CopyPath" {
                CopyPaths()
            }
            case "Properties" {
                OpenProperties()
            }
            case "SelectAll" {
                if ChooserAllowsMultiple() {
                    Model.SelectAll()
                }
            }
            case "ToggleSelection" {
                Model.ToggleFocusedSelection()
            }
            case "ToggleBookmark" {
                notice = settingsWriter?.ToggleBookmark(settings, Model.ActivePane().DirectoryPath) ?? ""
            }
            case "OpenBookmarks" {
                OpenDialog("Bookmarks", "")
            }
            case "NewFolder" {
                OpenDialog("New folder", "")
            }
            case "Rename" {
                if let entry = Model.ActivePane().SingleSelectedEntry() {
                    OpenDialog("Rename", entry.Name)
                }
            }
            case "Copy" {
                Model.Copy()
            }
            case "Cut" {
                Model.Copy(true)
            }
            case "Paste" {
                Model.Paste()
            }
            case "Trash" {
                if Model.ActivePane().SelectedPaths.Count > 0 {
                    OpenDialog("Move to Trash", Model.ActivePane().SelectionSummary())
                }
            }
            case "Restore" {
                Model.Restore()
            }
            case "DeletePermanently" {
                if Model.AtTrashRoot && Model.ActivePane().SelectedPaths.Count > 0 {
                    OpenDialog("Delete permanently", Model.ActivePane().SelectionSummary())
                }
            }
            case "EmptyTrash" {
                if Model.AtTrashRoot && Model.Places.TrashCount > 0 {
                    OpenDialog(
                        "Empty Trash",
                        Model.Places.TrashCount == 1 ? "1 item": "all " + Model.Places.TrashCount.ToString() + " items"
                    )
                }
            }
            case "ShowInFolder" {
                Model.ShowInFolder()
            }
            case "OpenSettings" {
                OpenPreferences()
            }
            case "Quit" {
                Host.RequestClose()
            }
            case "Dismiss" {
                if Host.PlatformInput.CancelDrag() {
                    return
                }
                if chooser != nil {
                    CancelChooser()
                    return
                }
                if locationEditing {
                    locationEditing = false
                } else if Model.ActivePane().Filter != "" {
                    Model.SetFilter("")
                } else if Model.PreviewVisible {
                    Model.TogglePreview()
                    SavePreferences()
                } else {
                    Model.ClearSelection()
                }
                FocusFiles()
            }
        }
        Rebuild()
    }

    private func IsMovement(action string) bool -> action == "MoveUp" || action == "MoveDown"
    || action == "MoveLeft" || action == "MoveRight" || action == "MoveFirst" || action == "MoveLast"
    || action == "PageUp" || action == "PageDown"

    private func ListKeys()[]KeyBinding {
        let bindings = List[KeyBinding]()
        for pair in settings.Keybindings {
            if !IsMovement(pair.Key) {
                continue
            }
            let action = pair.Key
            let shortcut = Shortcut.Parse(pair.Value)
            var key Key
            if !Enum.TryParse[Key](shortcut.Key, out key) {
                continue
            }
            let baseCtrl = shortcut.Ctrl
            let baseShift = shortcut.Shift
            let alt = shortcut.Alt
            let super = shortcut.Super
            for variant in 0 ... 4 {
                let ctrl = variant == 1 || variant == 3
                let shift = variant >= 2
                if (ctrl && baseCtrl) || (shift && baseShift) {
                    continue
                }
                let assigned = settings.ActionFor(key.ToString(), baseCtrl || ctrl, alt, baseShift || shift, super)
                if variant > 0 && assigned != "" {
                    continue
                }
                bindings.Add(
                    KeyBinding{
                        Key: key,
                        Modifiers: KeyModifiers{
                            Ctrl: baseCtrl || ctrl,
                            Alt: alt,
                            Shift: baseShift || shift,
                            Super: super
                        },
                        Repeat: true,
                        Action: () -> MoveFiles(action, ctrl, shift),
                    }
                )
            }
        }
        return bindings.ToArray()
    }

    private func MoveFiles(action string, ctrl bool, shift bool) {
        let multiple = ChooserAllowsMultiple()
        let control = ctrl && multiple
        let extend = shift && multiple
        let tiles = settings.ViewMode == "tiles"
        let columns = if tiles {
            TileColumns(Model.ActiveIndex)
        } else {
            1
        }
        switch action {
            case "MoveUp" {
                if !tiles || Model.ActivePane().Selected >= columns {
                    Model.MoveSelection(-columns, control, extend)
                }
            }
            case "MoveDown" {
                let pane = Model.ActivePane()
                if !tiles || pane.Selected / columns < (pane.VisibleEntries.Count - 1) / columns {
                    Model.MoveSelection(columns, control, extend)
                }
            }
            case "MoveLeft" {
                if tiles {
                    Model.MoveSelection(-1, control, extend)
                }
            }
            case "MoveRight" {
                if tiles {
                    Model.MoveSelection(1, control, extend)
                }
            }
            case "MoveFirst" {
                Model.MoveTo(0, control, extend)
            }
            case "MoveLast" {
                Model.MoveTo(Model.ActivePane().VisibleEntries.Count - 1, control, extend)
            }
            case "PageUp" {
                Model.MoveSelection(-PageSize(), control, extend)
            }
            case "PageDown" {
                Model.MoveSelection(PageSize(), control, extend)
            }
        }
        ChooserSelectionChanged()
        Rebuild()
    }

    private func TileColumns(index int32) int32 {
        let list = PaneViewport(index)
        return Math.Max(
            1,
            int32(Math.Floor((list.ContentBox.Width + FileTiles.Gap) / (FileTiles.TileWidth + FileTiles.Gap)))
        )
    }

    private func TileWidth(index int32) float64 {
        let room = paneViews[index].TileViewport.ContentBox.Width
        if room <= 0 {
            return FileTiles.TileWidth
        }
        let columns = Math.Max(1, Math.Floor((room + FileTiles.Gap) / (FileTiles.TileWidth + FileTiles.Gap)))
        return Math.Floor((room - (columns - 1) * FileTiles.Gap) / columns)
    }

    private func ListKey(e KeyEvent) {
        if e.IsComposing {
            return
        }
        let action = settings.ActionFor(
            e.Key.ToString(),
            e.Modifiers.Ctrl,
            e.Modifiers.Alt,
            e.Modifiers.Shift,
            e.Modifiers.Super
        )
        if action == "Open" || action == "TogglePreview" {
            Invoke(action)
            e.PreventDefault()
            e.StopPropagation()
        }
    }

    private func RevealSelection(state BrowserPaneViewState) {
        let index = Model.Panes.IndexOf(state.Pane)
        if index < 0 {
            return
        }
        let pane = state.Pane
        if pane.Selected >= 0 {
            let list = PaneViewport(index)
            let tiles = settings.ViewMode == "tiles"
            let row = if tiles {
                pane.Selected / TileColumns(index)
            } else {
                pane.Selected
            }
            let rowHeight = if tiles {
                FileTiles.TileHeight + FileTiles.Gap
            } else {
                FileTable.RowHeight
            }
            let top = row * rowHeight
            let bottom = top + if tiles {
                FileTiles.TileHeight
            } else {
                rowHeight
            }
            let offset = list.ScrollOffset.Y
            let viewport = list.ContentBox.Height
            if top < offset {
                list.JumpTo(0, top)
            } else if bottom > offset + viewport {
                list.JumpTo(0, Math.Max(0, bottom - viewport))
            }
            state.RevealPending = bottom > list.ScrollRange.Y + viewport
        } else {
            state.RevealPending = false
        }
    }

    private func PageSize() int32 {
        let list = PaneViewport(Model.ActiveIndex)
        let tiles = settings.ViewMode == "tiles"
        let rowHeight = if tiles {
            FileTiles.TileHeight + FileTiles.Gap
        } else {
            FileTable.RowHeight
        }
        return Math.Max(1, int32(Math.Floor(list.ContentBox.Height / rowHeight))) * if tiles {
            TileColumns(Model.ActiveIndex)
        } else {
            1
        }
    }

    private func FocusFiles() {
        PaneFocus(Model.ActiveIndex).Focus()
    }

    private func EditLocation() {
        if PaneWidth(Model.ActiveIndex) < 360 {
            OpenDialog("Open location", Model.ActivePane().DirectoryPath)
            return
        }
        locationText = Model.ActivePane().DirectoryPath
        locationEditing = true
        if locationHandle.IsMounted {
            locationHandle.Focus()
            Host.PlatformInput.Execute(TextCommand{Kind: TextCommandKind.SelectAll})
        } else {
            locationFocusPending = true
        }
        Rebuild()
    }

    private func SavePreferences() {
        if chooser != nil {
            return
        }
        notice = ""
        let error = settingsWriter?.Save(settings) ?? ""
        if error != "" {
            notice = error
        }
    }

    private func ApplyPreferences() {
        palette = Palette(settings.Theme, keyboardFocus)
        ApplyBackdrop()
        Host.WheelScrollScale = float32(settings.ScrollSpeed)
        Host.SmoothScrolling = settings.SmoothScrolling
        dialogError = ""
        SavePreferences()
        Rebuild()
    }

    private func SetPreferenceBinding(action string, value string) {
        preferenceInputs[action] = value
        dialogError = settings.ValidateBinding(action, value)
        Rebuild()
    }

    private func CommitPreferenceBinding(action string) {
        if !preferenceInputs.TryGetValue(action, out var value) {
            return
        }
        dialogError = settings.SetBinding(action, value)
        if dialogError == "" {
            SavePreferences()
        }
        Rebuild()
    }

    private func CommitPreferenceBindings() {
        var changed = false
        for input in preferenceInputs {
            let previous = settings.Keybindings[input.Key]
            if settings.SetBinding(input.Key, input.Value) == "" && previous != settings.Keybindings[input.Key] {
                changed = true
            }
        }
        if changed {
            SavePreferences()
        }
    }

    private func OpenDialog(kind string, value string) {
        locationEditing = false
        locationFocusPending = false
        dialog = kind
        dialogValue = value
        dialogError = ""
        Rebuild()
    }

    private func OpenPreferences() {
        if chooser != nil {
            return
        }
        preferenceInputs.Clear()
        preferenceTab = "Appearance"
        themeColorRole = "Background"
        revealThemeEditor = false
        OpenDialog("Preferences", "")
    }

    private func CloseDialog() {
        if setupBusy {
            return
        }
        CommitPreferenceBindings()
        Selection.CancelDescribe()
        focusScope?.Dispose()
        focusScope = nil
        dialog = ""
        dialogError = ""
        preferenceInputs.Clear()
        Rebuild()
    }

    private func SubmitDialog() {
        if dialog == "Replace file" {
            CloseDialog()
            AcceptChooser(true)
            return
        }
        if dialog == "New folder" {
            Model.CreateFolder(dialogValue)
        } else if dialog == "Rename" {
            Model.Rename(dialogValue)
        } else if dialog == "Move to Trash" {
            Model.Trash()
        } else if dialog == "Delete permanently" {
            Model.DeletePermanently()
        } else if dialog == "Empty Trash" {
            Model.EmptyTrash()
        } else if dialog == "Filter files" {
            Model.SetFilter(dialogValue)
        } else if dialog == "Open location" {
            Model.Navigate(dialogValue)
        }
        CloseDialog()
        FocusFiles()
    }

    private func ResetPreferencesTab() {
        if preferenceTab == "Shortcuts" {
            settings.ResetShortcuts()
            preferenceInputs.Clear()
        } else if preferenceTab == "Behavior" {
            settings.ResetBehavior()
        } else {
            settings.ResetAppearance()
            themeColorRole = "Background"
            revealThemeEditor = false
        }
        ApplyPreferences()
    }
}
