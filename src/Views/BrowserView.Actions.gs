package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func HandleKey(e KeyEvent) {
        if e.IsComposing && !e.Modifiers.Ctrl && !e.Modifiers.Alt && !e.Modifiers.Super {
            return
        }

        let action = ActionFor(e)

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

        if dialog == DialogKind.Preferences && Host.PlatformInput.Editor?.IsReadOnly == false
        && !e.Modifiers.Ctrl && !e.Modifiers.Alt && !e.Modifiers.Super
        && action != "FocusNext" && action != "FocusPrevious" && action != "Dismiss" {
            return
        }

        if dialog != DialogKind.None {
            if action == "Dismiss" {
                CloseDialog()
            } else if action == "Quit" {
                Host.RequestClose()
            } else if action == "FocusNext" {
                Host.PlatformInput.MoveFocus(true)
            } else if action == "FocusPrevious" {
                Host.PlatformInput.MoveFocus(false)
            } else if action == "Open" && dialog == DialogKind.MoveToTrash {
                SubmitDialog()
            } else {
                return
            }
        } else {
            let editor = Host.PlatformInput.Editor
            let previewFocused = editor?.IsReadOnly == true

            if editor != nil && !previewFocused && action != "Dismiss" && action != "Quit" && action != "FocusLocation"
            && action != "FocusFilter" && action != "FocusNext" && action != "FocusPrevious"
            && action != "OpenTerminal" && action != "OpenTerminalHere" {
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

    private func ActionFor(e KeyEvent) string -> settings.ActionFor(
        e.Key.ToString(),
        e.Modifiers.Ctrl,
        e.Modifiers.Alt,
        e.Modifiers.Shift,
        e.Modifiers.Super
    )

    private func Invoke(action string) {
        if !(chooser?.Allows(action) ?? true) || !Model.CanRun(action) {
            return
        }

        notice = ""

        if InvokeNavigation(action) || InvokeView(action) || InvokeFileAction(action) {
            Rebuild()
            return
        }

        switch action {
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

    private func InvokeNavigation(action string) bool {
        switch action {
            case "Open" {
                OpenBrowserSelection()
                return true
            }
            case "ContextMenu" or "ContextMenuAlternate" {
                OpenKeyboardContextMenu()
                return true
            }
            case "Parent" {
                Model.Parent()
                return true
            }
            case "Back" {
                Model.Back()
                return true
            }
            case "Forward" {
                Model.Forward()
                return true
            }
            case "Refresh" {
                Model.Refresh()
                return true
            }
            case "FocusLocation" {
                EditLocation()
                return true
            }
            case "FocusFilter" {
                if Model.Split || BrowsingWidth() < 560 {
                    OpenDialog(DialogKind.FilterFiles, Model.ActivePane().Filter)
                } else {
                    filterHandle.Focus()
                }

                return true
            }
            case "FocusNext" {
                Host.PlatformInput.MoveFocus(true)
                return true
            }
            case "FocusPrevious" {
                Host.PlatformInput.MoveFocus(false)
                return true
            }
            case "NextPane" {
                Model.SwitchPane()
                FocusFiles()
                return true
            }
        }

        return false
    }

    private func InvokeView(action string) bool {
        switch action {
            case "TogglePreview" {
                Model.TogglePreview()
                SavePreferences()

                if !Model.PreviewVisible {
                    FocusFiles()
                }

                return true
            }
            case "ToggleSplit" {
                Model.ToggleSplit()
                SavePreferences()
                FocusFiles()
                return true
            }
            case "ToggleHidden" {
                Model.ToggleHidden()
                SavePreferences()
                return true
            }
            case "ToggleTypeColumn" {
                settings.ShowTypeColumn = !settings.ShowTypeColumn
                SavePreferences()
                return true
            }
            case "ViewList" or "ViewTiles" {
                Model.SetViewMode(
                    if action == "ViewTiles" {
                        ViewMode.Tiles
                    } else {
                        ViewMode.List
                    }
                )
                SavePreferences()
                FocusFiles()

                let state = paneViews[Model.ActiveIndex]
                state.RevealPending = true
                Host.Post(() -> RevealSelection(state))

                return true
            }
            case "OpenTerminal" {
                Model.OpenTerminal()
                return true
            }
            case "OpenTerminalHere" {
                Model.OpenTerminal(false)
                return true
            }
            case "CopyPath" {
                CopyPaths()
                return true
            }
            case "Properties" {
                OpenProperties()
                return true
            }
            case "SelectAll" {
                if ChooserAllowsMultiple() {
                    Model.SelectAll()
                }

                return true
            }
            case "ToggleSelection" {
                Model.ToggleFocusedSelection()
                return true
            }
            case "ToggleBookmark" {
                notice = settingsWriter?.ToggleBookmark(settings, Model.ActivePane().DirectoryPath) ?? ""
                return true
            }
            case "OpenBookmarks" {
                OpenDialog(DialogKind.Bookmarks, "")
                return true
            }
        }

        return false
    }

    private func InvokeFileAction(action string) bool {
        switch action {
            case "NewFolder" {
                OpenDialog(DialogKind.NewFolder, "")
                return true
            }
            case "Rename" {
                if let entry = Model.ActivePane().SingleSelectedEntry() {
                    OpenDialog(DialogKind.Rename, entry.Name)
                }

                return true
            }
            case "Copy" {
                Model.Copy()
                return true
            }
            case "Cut" {
                Model.Copy(true)
                return true
            }
            case "Paste" {
                Model.Paste()
                return true
            }
            case "Trash" {
                if Model.ActivePane().SelectedPaths.Count > 0 {
                    OpenDialog(DialogKind.MoveToTrash, Model.ActivePane().SelectionSummary())
                }

                return true
            }
            case "Restore" {
                Model.Restore()
                return true
            }
            case "DeletePermanently" {
                if Model.AtTrashRoot && Model.ActivePane().SelectedPaths.Count > 0 {
                    OpenDialog(DialogKind.DeletePermanently, Model.ActivePane().SelectionSummary())
                }

                return true
            }
            case "EmptyTrash" {
                if Model.AtTrashRoot && Model.Places.TrashCount > 0 {
                    OpenDialog(
                        DialogKind.EmptyTrash,
                        Model.Places.TrashCount == 1 ? "1 item": "all " + Model.Places.TrashCount.ToString() + " items"
                    )
                }

                return true
            }
            case "ShowInFolder" {
                Model.ShowInFolder()
                return true
            }
            case "OpenSettings" {
                OpenPreferences()
                return true
            }
        }

        return false
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
        let tiles = settings.ViewMode == ViewMode.Tiles
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

    private func ListKey(e KeyEvent) {
        if e.IsComposing {
            return
        }

        let action = ActionFor(e)

        if action == "Open" || action == "TogglePreview" {
            Invoke(action)
            e.PreventDefault()
            e.StopPropagation()
        }
    }
}
