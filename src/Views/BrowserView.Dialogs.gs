package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private let dialogButtons Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    private func DialogButton(label string, action Action, p Palette, primary bool = false) Blob {
        if !dialogButtons.TryGetValue(label, out var handle) {
            handle = ElementHandle()
            dialogButtons[label] = handle
        }
        return Ui.ActionButton(label, action, p, primary, handle)
    }

    private func Dialog() Blob {
        let p = palette
        if dialog == "Desktop setup" {
            return SetupDialog()
        }
        if dialog == "Properties" {
            return PropertiesDialog()
        }
        if dialog == "Bookmarks" {
            return DialogShell.Build(
                dialog,
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
            dialog,
            content,
            actions,
            dialogHandle,
            () -> CloseDialog(),
            HandleKey,
            WidgetKeyBindings.Editing(window?.PlatformInput),
            Host,
            p,
            if dialog == "Preferences" {
                Math.Clamp(width - 80, 360, 600)
            } else if dialog == "Open location" {
                520
            } else {
                440
            },
            dialog == "Preferences" && height < 600,
            maxHeight: dialog == "Preferences" ? 80: 88
        )
    }

    private func DialogContent(p Palette) Blob {
        let contents = List[Blob]()
        if dialog == "Preferences" {
            contents.Add(PreferencesContent())
        } else if dialog == "Move to Trash" {
            contents.Add(Text{Content: "Move " + dialogValue + " to Trash?", FontSize: 14, Color: p.Text})
            contents.Add(
                Text{Content: "You can restore these items from your desktop's Trash.", FontSize: 12, Color: p.Muted}
            )
        } else if dialog == "Delete permanently" || dialog == "Empty Trash" {
            contents.Add(Text{Content: "Delete " + dialogValue + " permanently?", FontSize: 14, Color: p.Text})
            contents.Add(Text{Content: "This cannot be undone.", FontSize: 12, Color: p.Muted})
        } else if dialog == "Replace file" {
            contents.Add(
                Text{Content: "A file already exists at this location. Replace it?", FontSize: 14, Color: p.Text}
            )
            contents.Add(Text{Content: dialogValue, FontSize: 12, Color: p.Muted, TextWrap: TextWrap.Wrap})
        } else {
            contents.Add(
                TextEntry{
                    Handle: dialogInput,
                    Value: dialogValue,
                    Controlled: true,
                    AutoFocus: true,
                    Height: 38,
                    Padding: Edges{Left: 10, Right: 10},
                    FontSize: 14,
                    BackgroundColor: p.Background,
                    Color: p.Text,
                    BorderWidth: 1,
                    BorderColor: p.Border,
                    BorderRadius: 6,
                    Focus: Style{BorderColor: p.Accent},
                    Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: dialog},
                    OnChange: value -> {
                        dialogValue = value
                    },
                    OnSubmit: (_) -> SubmitDialog(),
                }
            )
        }
        if dialogError != "" {
            contents.Add(Text{Content: dialogError, Color: p.Error, FontSize: 12})
        }
        let content = Container{
            MinHeight: 0,
            FlexShrink: dialog == "Preferences" ? 1: 0,
            Gap: 14,
            Children: contents.ToArray(),
        }
        return content
    }

    private func DialogActions(p Palette) Blob {
        let buttons = List[Blob]()
        if dialog == "Preferences" {
            buttons.Add(DialogButton("Reset " + preferenceTab.ToLowerInvariant(), () -> ResetPreferencesTab(), p))
            buttons.Add(Container{FlexGrow: 1})
            let close = DialogButton("Close", () -> CloseDialog(), p)
            close.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: "Close preferences"}
            buttons.Add(close)
        } else {
            buttons.Add(DialogButton("Cancel", () -> CloseDialog(), p))
        }
        if dialog != "Preferences" {
            buttons.Add(
                DialogButton(
                    if dialog == "Move to Trash" || dialog == "Delete permanently" || dialog == "Empty Trash" {
                        dialog
                    } else if dialog == "Replace file" {
                        "Replace"
                    } else if dialog == "New folder" {
                        "Create folder"
                    } else if dialog == "Open location" {
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
                    FolderName(path),
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
        return Container{
            Height: Math.Min(settings.Bookmarks.Count * 34, Math.Clamp(height * .88 - 150, 80, 360)),
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Ui.ScrollbarStyle(p),
            ScrollbarVisibilityY: ScrollbarVisibility.Always,
            Padding: Edges{Right: 12},
            Gap: 4,
            Children: rows.ToArray(),
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
}
