package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private let dialogButtons Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    private func DialogTitle(kind DialogKind) string -> switch kind {
        case DialogKind.Preferences: "Preferences"
        case DialogKind.DesktopSetup: "Desktop setup"
        case DialogKind.Properties: "Properties"
        case DialogKind.Bookmarks: "Bookmarks"
        case DialogKind.OpenLocation: "Open location"
        case DialogKind.FilterFiles: "Filter files"
        case DialogKind.NewFolder: "New folder"
        case DialogKind.Rename: "Rename"
        case DialogKind.MoveToTrash: "Move to Trash"
        case DialogKind.DeletePermanently: "Delete permanently"
        case DialogKind.EmptyTrash: "Empty Trash"
        case DialogKind.ReplaceFile: "Replace file"
        default: ""
    }

    private func DialogButton(label string, action Action, p Palette, primary bool = false) Blob {
        if !dialogButtons.TryGetValue(label, out var handle) {
            handle = ElementHandle()
            dialogButtons[label] = handle
        }
        return Ui.ActionButton(label, action, p, primary, handle)
    }

    private func Dialog() Blob {
        let p = palette
        if dialog == DialogKind.DesktopSetup {
            return SetupDialog()
        }
        if dialog == DialogKind.Properties {
            return PropertiesDialog()
        }
        if dialog == DialogKind.Bookmarks {
            return DialogShell.Build(
                DialogTitle(dialog),
                BookmarkChoices(),
                Container{FlexDirection: FlexDirection.Row, Gap: 8, DialogButton("Close", () -> CloseDialog(), p)},
                dialogHandle,
                () -> CloseDialog(),
                HandleKey,
                WidgetKeyBindings.Editing(window?.PlatformInput),
                Host,
                p,
                520
            )
        }
        let content = DialogContent(p)
        let actions = DialogActions(p)
        return DialogShell.Build(
            DialogTitle(dialog),
            content,
            actions,
            dialogHandle,
            () -> CloseDialog(),
            HandleKey,
            WidgetKeyBindings.Editing(window?.PlatformInput),
            Host,
            p,
            if dialog == DialogKind.Preferences {
                Math.Clamp(width - 80, 360, 600)
            } else if dialog == DialogKind.OpenLocation {
                520
            } else {
                440
            },
            dialog == DialogKind.Preferences && height < 600,
            maxHeight: dialog == DialogKind.Preferences ? 80: 88
        )
    }

    private func DialogContent(p Palette) Blob {
        let contents = List[Blob]()
        if dialog == DialogKind.Preferences {
            contents.Add(PreferencesContent())
        } else if dialog == DialogKind.MoveToTrash {
            contents.Add(Text{Content: "Move " + dialogValue + " to Trash?", FontSize: 14, Color: p.Text})
            contents.Add(
                Text{Content: "You can restore these items from your desktop's Trash.", FontSize: 12, Color: p.Muted}
            )
        } else if dialog == DialogKind.DeletePermanently || dialog == DialogKind.EmptyTrash {
            contents.Add(Text{Content: "Delete " + dialogValue + " permanently?", FontSize: 14, Color: p.Text})
            contents.Add(Text{Content: "This cannot be undone.", FontSize: 12, Color: p.Muted})
        } else if dialog == DialogKind.ReplaceFile {
            contents.Add(
                Text{Content: "A file already exists at this location. Replace it?", FontSize: 14, Color: p.Text}
            )
            contents.Add(Text{Content: dialogValue, FontSize: 12, Color: p.Muted, TextWrap: TextWrap.Wrap})
        } else {
            contents.Add(
                TextField.Build(
                    dialogValue,
                    value -> dialogValue = value,
                    (_) -> SubmitDialog(),
                    DialogTitle(dialog),
                    p,
                    handle: dialogInput,
                    autoFocus: true,
                    fontSize: 14,
                    padding: 10
                )
            )
        }
        if dialogError != "" {
            contents.Add(Ui.ErrorText(dialogError, p))
        }
        let content = Container{
            MinHeight: 0,
            FlexShrink: dialog == DialogKind.Preferences ? 1: 0,
            Gap: 14,
            Children: contents.ToArray(),
        }
        return content
    }

    private func DialogActions(p Palette) Blob {
        let buttons = List[Blob]()
        if dialog == DialogKind.Preferences {
            buttons.Add(DialogButton("Reset " + preferenceTab.ToLowerInvariant(), () -> ResetPreferencesTab(), p))
            buttons.Add(Container{FlexGrow: 1})
            let close = DialogButton("Close", () -> CloseDialog(), p)
            close.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: "Close preferences"}
            buttons.Add(close)
        } else {
            buttons.Add(DialogButton("Cancel", () -> CloseDialog(), p))
        }
        if dialog != DialogKind.Preferences {
            buttons.Add(
                DialogButton(
                    if dialog == DialogKind.MoveToTrash ||
                        dialog == DialogKind.DeletePermanently ||
                        dialog == DialogKind.EmptyTrash {
                        DialogTitle(dialog)
                    } else if dialog == DialogKind.ReplaceFile {
                        "Replace"
                    } else if dialog == DialogKind.NewFolder {
                        "Create folder"
                    } else if dialog == DialogKind.OpenLocation {
                        "Open"
                    } else {
                        "Apply"
                    },
                    () -> SubmitDialog(),
                    p,
                    true
                )
            )
        }
        let actions = Container{
            FlexDirection: FlexDirection.Row,
            JustifyContent: JustifyContent.FlexEnd,
            Gap: 10,
            Children: buttons.ToArray(),
        }
        return actions
    }

    private func BookmarkChoices() Blob {
        let p = palette
        if settings.Bookmarks.Count == 0 {
            return Text{
                Content: "No bookmarks yet. Use " +
                    settings.Keybindings["ToggleBookmark"] +
                    " to add the current folder.",
                Color: p.Muted,
                FontSize: 13,
                TextWrap: TextWrap.Wrap,
            }
        }
        let rows = List[Blob]()
        for path in settings.Bookmarks {
            rows.Add(
                PlacesSidebar.Bookmark(
                    path,
                    Locations.DisplayName(path, home),
                    Model.ActivePane().DirectoryPath,
                    destination -> {
                        CloseDialog()
                        Model.Navigate(destination)
                        FocusFiles()
                    },
                    Host,
                    p,
                    PortalPlacement.Bottom
                )
            )
        }
        return DialogShell.ScrollColumn(
            rows.ToArray(),
            p,
            Ui.ToolsGap,
            Math.Min(
                settings.Bookmarks.Count * (SidebarLink.RowHeight + Ui.ToolsGap),
                Math.Clamp(height * .88 - 150, 80, 360)
            ),
            0
        )
    }

    private func OpenDialog(kind DialogKind, value string) {
        locationEditing = false
        locationFocusPending = false
        dialog = kind
        dialogValue = value
        dialogError = ""
        Rebuild()
    }

    private func CloseDialog() {
        if setupBusy {
            return
        }
        CommitPreferenceBindings()
        Selection.CancelDescribe()
        focusScope?.Dispose()
        focusScope = nil
        dialog = DialogKind.None
        dialogError = ""
        preferenceInputs.Clear()
        Rebuild()
    }

    private func SubmitDialog() {
        if dialog == DialogKind.ReplaceFile {
            CloseDialog()
            AcceptChooser(true)
            return
        }
        if dialog == DialogKind.NewFolder {
            Model.CreateFolder(dialogValue)
        } else if dialog == DialogKind.Rename {
            Model.Rename(dialogValue)
        } else if dialog == DialogKind.MoveToTrash {
            Model.Trash()
        } else if dialog == DialogKind.DeletePermanently {
            Model.DeletePermanently()
        } else if dialog == DialogKind.EmptyTrash {
            Model.EmptyTrash()
        } else if dialog == DialogKind.FilterFiles {
            Model.SetFilter(dialogValue)
        } else if dialog == DialogKind.OpenLocation {
            Model.Navigate(dialogValue)
        }
        CloseDialog()
        FocusFiles()
    }
}
