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

    private func OpenPreferences() {
        if chooser != nil {
            return
        }

        preferenceInputs.Clear()
        preferenceTab = "Appearance"
        themeColorRole = "Background"
        revealThemeEditor = false

        OpenDialog(DialogKind.Preferences, "")
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

    private func PreferencesContent() Blob {
        let p = palette
        let values = settings
        let compact = height < 600
        let rows = List[Blob]()

        if preferenceTab == "Shortcuts" {
            ShortcutRows(rows, values, p)
        } else if preferenceTab == "Behavior" {
            BehaviorRows(rows, values, p)
        } else {
            AppearanceRows(rows, values, p, compact)
        }

        let tabs = Container{FlexDirection: FlexDirection.Row, Gap: 6}

        for name in[]string{"Shortcuts", "Behavior", "Appearance"} {
            let tab = name
            let button = DialogButton(
                tab,
                () -> {
                    CommitPreferenceBindings()
                    preferenceTab = tab
                    Rebuild()
                },
                p,
                preferenceTab == tab
            )
            button.FlexGrow = 1
            button.FlexBasis = 0
            button.Padding = Edges{Left: 6, Right: 6}
            tabs.Children.Add(button)
        }

        return Container{
            MinHeight: 0,
            FlexShrink: 1,
            Gap: if compact {
                8
            } else {
                16
            },
            tabs,
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
                TextWrap: TextWrap.Wrap,
            },
            DialogShell.ScrollColumn(rows.ToArray(), p),
        }
    }

    private func ShortcutRows(rows List[Blob], values AppSettings, p Palette) {
        for pair in values.Keybindings {
            let action = pair.Key
            let input = preferenceInputs.TryGetValue(action, out var typed) ? typed: pair.Value

            rows.Add(
                PreferenceRow(
                    AppSettings.ActionCatalog[action].Label,
                    input,
                    value -> SetPreferenceBinding(action, value),
                    () -> CommitPreferenceBinding(action),
                    p,
                    values.ValidateBinding(action, input) != ""
                )
            )
        }
    }

    private func BehaviorRows(rows List[Blob], values AppSettings, p Palette) {
        rows.Add(DialogButton("Desktop setup", () -> OpenSetup(), p))
        rows.Add(
            PreferenceRow.Toggle(
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
            PreferenceRow.Toggle(
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
            PreferenceRow.Toggle(
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
            PreferenceRow
                .Build(
                "",
                Cell.Mount[SliderInput, Slider](
                    "scroll-speed",
                    SliderInput{
                        Value: values.ScrollSpeed,
                        Minimum: AppSettings.MinimumScrollSpeed,
                        Maximum: AppSettings.MaximumScrollSpeed,
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
                        ShowFocusHighlight: p.Keyboard,
                        FocusOutlineColor: p.Accent,
                    }
                ),
                p,
                scrollSpeedRow,
                true
            ){.Padding: Edges{Left: 10, Right: 10, Top: 10, Bottom: 6}}
        )
    }

    private func AppearanceRows(rows List[Blob], values AppSettings, p Palette, compact bool) {
        let choices = List[Blob]()

        choices.Add(
            ThemeChoice.Build(
                AppSettings.CustomThemeName,
                values.CustomTheme,
                values.ThemeName == AppSettings.CustomThemeName,
                p.Keyboard,
                () -> {
                    values.SelectTheme(AppSettings.CustomThemeName)
                    revealThemeEditor = true
                    ApplyPreferences()
                }
            )
        )

        for name in ThemePresets.Names() {
            let presetName = name

            choices.Add(
                ThemeChoice.Build(
                    name,
                    ThemePresets.Create(name),
                    name == values.ThemeName,
                    p.Keyboard,
                    () -> {
                        values.SelectTheme(presetName)
                        revealThemeEditor = false
                        ApplyPreferences()
                    }
                )
            )
        }

        let columns = width >= 640 ? 2: 1

        for var index = 0;
        index < choices.Count;
        index += columns {
            let pair = Container{FlexDirection: FlexDirection.Row, FlexShrink: 0, Gap: 8}

            for offset in 0 ... columns {
                let slot = Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0}

                if index + offset < choices.Count {
                    slot.Children.Add(choices[index + offset])
                }

                pair.Children.Add(slot)
            }

            rows.Add(pair)
        }

        if values.ThemeName == AppSettings.CustomThemeName {
            AppearanceColorRows(rows, values, p, compact)
        }
    }

    private func AppearanceColorRows(rows List[Blob], values AppSettings, p Palette, compact bool) {
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
                                p.Keyboard,
                                value -> {
                                    let color = "#" + ColorMath.Hex(value)
                                    values.SetCustomColor(selectedRole, color)
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

        let field = TextField.Build(
            value,
            change,
            (_) -> commit(),
            label,
            p,
            invalid,
            160,
            handle,
            fontSize: 12,
            padding: 10
        )
        field.OnFocus = (_) -> handle.ScrollIntoView()
        field.OnBlur = (_) -> commit()

        return PreferenceRow.Build(label, field, p)
    }
}
