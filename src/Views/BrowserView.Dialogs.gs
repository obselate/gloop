package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Colors
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.Globalization
import System.IO

partial class BrowserView {
    private func Dialog() Blob {
        let p = palette
        if dialog == "Bookmarks" {
            return DialogShell.Build(
                dialog,
                BookmarkChoices(),
                Container{FlexDirection: FlexDirection.Row, Gap: 8, Ui.ActionButton("Close", () -> CloseDialog(), p)},
                dialogHandle,
                () -> CloseDialog(),
                HandleKey,
                WidgetKeyBindings.Editing(window?.PlatformInput),
                Host,
                p,
                520
            )
        }
        let contents = List[Blob]()
        if dialog == "Preferences" {
            contents.Add(PreferencesContent())
        } else if dialog == "Move to Trash" {
            contents.Add(Text{Content: "Move " + dialogValue + " to Trash?", FontSize: 14, Color: p.Text})
            contents.Add(
                Text{Content: "You can restore these items from your desktop's Trash.", FontSize: 12, Color: p.Muted}
            )
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
        let content = Container{MinHeight: 0, Gap: 14, Children: contents.ToArray()}
        let buttons = List[Blob]()
        if dialog == "Preferences" {
            buttons.Add(Ui.ActionButton("Reset " + preferenceTab.ToLowerInvariant(), () -> ResetPreferencesTab(), p))
            buttons.Add(Container{FlexGrow: 1})
            let close = Ui.ActionButton("Close", () -> CloseDialog(), p)
            close.Accessibility = Accessibility{Role: AccessibilityRole.Button, Name: "Close preferences"}
            buttons.Add(close)
        } else {
            buttons.Add(Ui.ActionButton("Cancel", () -> CloseDialog(), p))
        }
        if dialog != "Preferences" {
            buttons.Add(
                Ui.ActionButton(
                    if dialog == "Move to Trash" {
                        "Move to Trash"
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
                580
            } else if dialog == "Open location" {
                520
            } else {
                440
            },
            dialog == "Preferences" && height < 600
        )
    }

    private func PreferencesContent() Blob {
        let p = palette
        let values = settings
        let compact = height < 600
        let listHeight = if compact {
            height - 226
        } else {
            height - 260
        }
        let rows = List[Blob]()
        if preferenceTab == "Shortcuts" {
            for pair in values.Keybindings {
                let action = pair.Key
                let input = preferenceInputs.TryGetValue(action, out var typed) ? typed: pair.Value
                rows.Add(
                    PreferenceRow(
                        ActionLabel(action),
                        input,
                        value -> SetPreferenceBinding(action, value),
                        () -> CommitPreferenceBinding(action),
                        p,
                        values.ValidateBinding(action, input) != ""
                    )
                )
            }
        } else if preferenceTab == "Behavior" {
            rows.Add(
                PreferenceToggle.Build(
                    "Smooth scrolling",
                    values.SmoothScrolling,
                    () -> {
                        values.SmoothScrolling = !values.SmoothScrolling
                        ApplyPreferences()
                    },
                    smoothScrollingRow,
                    p
                )
            )
            rows.Add(
                PreferenceToggle.Build(
                    "Wrap text previews",
                    values.PreviewWordWrap,
                    () -> {
                        values.PreviewWordWrap = !values.PreviewWordWrap
                        ApplyPreferences()
                    },
                    previewWordWrapRow,
                    p
                )
            )
            rows.Add(
                PreferenceToggle.Build(
                    "Show preview line numbers",
                    values.PreviewLineNumbers,
                    () -> {
                        values.PreviewLineNumbers = !values.PreviewLineNumbers
                        ApplyPreferences()
                    },
                    previewLineNumbersRow,
                    p
                )
            )
            rows.Add(
                Container{
                    Handle: scrollSpeedRow,
                    OnFocus: (_) -> scrollSpeedRow.ScrollIntoView(),
                    FlexShrink: 0,
                    Padding: Edges{Left: 10, Right: 10, Top: 10, Bottom: 6},
                    Cell.Mount[SliderInput, Slider](
                        "scroll-speed",
                        SliderInput{
                            Value: values.ScrollSpeed,
                            Minimum: .25,
                            Maximum: 4,
                            Step: .25,
                            Label: "Scroll speed",
                            ShowValue: true,
                            FormatValue: value -> value.ToString("0.##", CultureInfo.InvariantCulture) + "×",
                            OnValueChanged: value -> {
                                values.ScrollSpeed = value
                                ApplyPreferences()
                            },
                            LabelColor: p.Text,
                            ValueColor: p.Muted,
                            TrackColor: p.Border,
                            FillColor: p.Accent,
                            ThumbColor: p.Accent,
                            ThumbBorderColor: p.Surface,
                            TrackThickness: 4,
                            ThumbSize: 14,
                            ShowFocusHighlight: true,
                            FocusOutlineColor: p.Accent,
                        }
                    ),
                }
            )
        } else {
            rows.Add(
                ThemeChoice.Build(
                    "Custom",
                    values.CustomTheme,
                    values.ThemeName == "Custom",
                    () -> {
                        values.ThemeName = "Custom"
                        values.Theme.ApplyFrom(values.CustomTheme)
                        revealThemeEditor = true
                        ApplyPreferences()
                    }
                )
            )
            if values.ThemeName == "Custom" {
                for role in ThemePresets.Roles() {
                    let selectedRole = role
                    let roleRow = ThemeColorRole.Build(
                        role,
                        values.CustomTheme.ColorFor(role),
                        role == themeColorRole,
                        () -> {
                            if themeColorRole != selectedRole {
                                themeColorRole = selectedRole
                                revealThemeEditor = true
                                Rebuild()
                            }
                        },
                        p
                    )
                    if role == themeColorRole {
                        rows.Add(
                            Container{
                                Handle: themeEditorHandle,
                                OnFocus: (_) -> themeEditorHandle.ScrollIntoView(),
                                FlexShrink: 0,
                                Gap: if compact {
                                    4
                                } else {
                                    6
                                },
                                roleRow,
                                Container{
                                    FlexShrink: 0,
                                    AlignItems: AlignItems.Center,
                                    Gap: 6,
                                    Padding: Edges{
                                        Top: if compact {
                                            2
                                        } else {
                                            4
                                        },
                                        Bottom: 8
                                    },
                                    ThemeColorEditor.Build(
                                        role,
                                        ColorMath.ParseHex(values.CustomTheme.ColorFor(role)) ?? 0,
                                        Math.Clamp(height - 320, 80, 180),
                                        if compact {
                                            8
                                        } else {
                                            12
                                        },
                                        p.Accent,
                                        value -> {
                                            let color = "#" + ColorMath.Hex(value)
                                            values.CustomTheme.SetColor(selectedRole, color)
                                            values.Theme.SetColor(selectedRole, color)
                                            ApplyPreferences()
                                        },
                                    )
                                },
                            }
                        )
                    } else {
                        rows.Add(roleRow)
                    }
                }
            }
            for name in ThemePresets.Names() {
                let presetName = name
                rows.Add(
                    ThemeChoice.Build(
                        name,
                        ThemePresets.Create(name),
                        name == values.ThemeName,
                        () -> {
                            values.ThemeName = presetName
                            values.Theme = ThemePresets.Create(presetName)
                            revealThemeEditor = false
                            ApplyPreferences()
                        }
                    )
                )
            }
        }
        return Container{
            MinHeight: 0,
            Gap: if compact {
                8
            } else {
                16
            },
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: 8,
                Ui.ActionButton(
                    "Shortcuts",
                    () -> {
                        CommitPreferenceBindings()
                        preferenceTab = "Shortcuts"
                        Rebuild()
                    },
                    p,
                    preferenceTab == "Shortcuts"
                ),
                Ui.ActionButton(
                    "Behavior",
                    () -> {
                        CommitPreferenceBindings()
                        preferenceTab = "Behavior"
                        Rebuild()
                    },
                    p,
                    preferenceTab == "Behavior"
                ),
                Ui.ActionButton(
                    "Appearance",
                    () -> {
                        CommitPreferenceBindings()
                        preferenceTab = "Appearance"
                        Rebuild()
                    },
                    p,
                    preferenceTab == "Appearance"
                ),
            },
            Text{
                Content: if preferenceTab == "Shortcuts" {
                    "Press Enter or leave the field to apply a shortcut, such as Ctrl+S."
                } else if preferenceTab == "Behavior" {
                    "Adjust scrolling and text previews."
                } else {
                    "Choose a preset or edit Custom with the OKLCH wheel."
                },
                Color: p.Muted,
                FontSize: 12,
            },
            Container{
                Height: Math.Max(
                    80,
                    Math.Min(
                        if preferenceTab == "Behavior" {
                            220
                        } else if preferenceTab == "Appearance" {
                            390
                        } else {
                            310
                        },
                        listHeight
                    )
                ),
                MinHeight: 0,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Ui.ScrollbarStyle(p),
                ScrollbarVisibilityY: ScrollbarVisibility.Always,
                Gap: 8,
                Padding: Edges{Right: 12},
                Children: rows.ToArray()
            },
        }
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

    private func PreferenceRow(
        label string,
        value string,
        change Action[string],
        commit Action,
        p Palette,
        invalid bool
    ) Blob {
        if !preferenceHandles.TryGetValue(label, out var handle) {
            handle = ElementHandle()
            preferenceHandles[label] = handle
        }
        return Container{
            Height: 38,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 18,
            Container{FlexGrow: 1, MinWidth: 0, Ui.Label(label, p.Text, 13)},
            TextEntry{
                Handle: handle,
                Value: value,
                Controlled: true,
                Width: 160,
                Height: 34,
                Padding: Edges{Left: 10, Right: 10},
                BackgroundColor: p.Background,
                Color: p.Text,
                FontSize: 12,
                BorderWidth: 1,
                BorderColor: invalid ? p.Error: p.Border,
                BorderRadius: 5,
                Focus: Style{BorderColor: invalid ? p.Error: p.Accent},
                OnChange: change,
                OnSubmit: (_) -> commit(),
                OnFocus: (_) -> handle.ScrollIntoView(),
                OnBlur: (_) -> commit(),
                Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: label, Invalid: invalid},
            },
        }
    }

    private func ActionLabel(action string) string {
        if action == "ContextMenu" {
            return "Open context menu"
        }
        if action == "ContextMenuAlternate" {
            return "Open context menu (alternate)"
        }
        let result = System.Text.StringBuilder()
        for index in 0 ... action.Length {
            if index > 0 && Char.IsUpper(action[index]) {
                result.Append(' ')
            }
            result.Append(action[index])
        }
        return result.ToString()
    }
}
