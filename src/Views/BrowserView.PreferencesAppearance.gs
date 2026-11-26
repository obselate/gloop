package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Colors
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.Globalization

partial class BrowserView {
    private let glassEffectRow ElementHandle = ElementHandle()
    private let glassOpacityRow ElementHandle = ElementHandle()

    private func AppearanceRows(rows List[Blob], values AppSettings, p Palette, compact bool) {
        let glassItems = List[Blob]()

        glassItems.Add(
            PreferenceRow.Toggle(
                "Glass effect",
                values.Theme.Glass,
                () -> {
                    values.SetGlass(!values.Theme.Glass)
                    ApplyPreferences()
                },
                glassEffectRow,
                p
            )
        )

        if values.Theme.Glass {
            let currentOpacity = int32(Math.Round(float64(p.Window.A) * 100))
            let slider = PreferenceRow.Slider(
                "glass-opacity",
                SliderInput{
                    Value: currentOpacity,
                    Minimum: 0,
                    Maximum: 100,
                    Step: 5,
                    AccessibilityName: "Glass opacity",
                    FormatValue: value -> value.ToString("0", CultureInfo.InvariantCulture) + "%",
                    OnChange: value -> {
                        values.SetGlassOpacity(int32(value))
                        ApplyPreferences()
                    },
                },
                glassOpacityRow,
                p
            )
            glassItems.Add(
                Container{
                    FlexShrink: 0,
                    Gap: 6,
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        Container{FlexGrow: 1, FlexBasis: 0, Ui.Label("Glass opacity", p.Text, 13),},
                        Ui.Label(currentOpacity.ToString("0", CultureInfo.InvariantCulture) + "%", p.Muted, 12),
                    },
                    Container{
                        FlexDirection: FlexDirection.Row,
                        AlignItems: AlignItems.Center,
                        Gap: 8,
                        OpacityStepperButton(
                            "−",
                            "Decrease opacity by 5%",
                            currentOpacity <= 0,
                            () -> {
                                values.SetGlassOpacity(Math.Max(0, currentOpacity - 5))
                                ApplyPreferences()
                            },
                            p
                        ),
                        Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Padding: Edges{Left: 10, Right: 10}, slider,},
                        OpacityStepperButton(
                            "+",
                            "Increase opacity by 5%",
                            currentOpacity >= 100,
                            () -> {
                                values.SetGlassOpacity(Math.Min(100, currentOpacity + 5))
                                ApplyPreferences()
                            },
                            p
                        ),
                    },
                }
            )
        }

        rows.Add(
            Ui.SectionCard(
                "Surface & Glass",
                "Toggle translucent window chrome and backdrop blur for any theme.",
                glassItems.ToArray(),
                p
            )
        )

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

        let gridRows = List[Blob]()
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

            gridRows.Add(pair)
        }

        rows.Add(
            Ui.SectionCard(
                "Themes",
                "Choose a built-in Fluent, Glass, or terminal-inspired theme.",
                gridRows.ToArray(),
                p
            )
        )

        if values.ThemeName == AppSettings.CustomThemeName {
            AppearanceColorRows(rows, values, p, compact)
        } else {
            rows.Add(
                Ui.SectionCard(
                    "Custom Colors",
                    "Copy the active theme into Custom to fine-tune individual color roles.",
                    []Blob{
                        PreferenceRow.Build(
                            "Replaces your saved Custom colors.",
                            DialogButton(
                                "Copy to Custom",
                                () -> {
                                    values.CopyThemeToCustom()
                                    revealThemeEditor = true
                                    ApplyPreferences()
                                },
                                p
                            ),
                            p
                        ),
                    },
                    p
                )
            )
        }
    }

    private func AppearanceColorRows(rows List[Blob], values AppSettings, p Palette, compact bool) {
        let rolePills = Container{FlexDirection: FlexDirection.Row, FlexWrap: FlexWrap.Wrap, Gap: 6,}

        for role in ThemePresets.Roles() {
            let selectedRole = role
            let active = role == themeColorRole
            let hex = values.CustomTheme.ColorFor(role)

            rolePills.Children.Add(
                Button{
                    Handle: active ? themeRoleHandle: nil,
                    Height: 28,
                    Padding: Edges{Left: 8, Right: 10},
                    BorderRadius: p.ControlRadius,
                    BorderWidth: 1,
                    BorderColor: active ? p.Accent: p.Border,
                    BackgroundColor: active ? p.Selection: p.Surface,
                    HoverStyle: Style{BackgroundColor: active ? p.Selection: p.Hover},
                    FocusStyle: p.Ring(-1),
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    OnClick: () -> {
                        if themeColorRole != selectedRole {
                            themeColorRole = selectedRole
                            revealThemeEditor = true
                            Rebuild()
                        }
                    },
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: role + " " + hex},
                    Ui.ColorDot(hex, p),
                    Ui.Label(role, p.Text, 12, active ? 600: 400),
                }
            )
        }

        let activeHex = values.CustomTheme.ColorFor(themeColorRole)

        rows.Add(
            Ui.SectionCard(
                "Custom Colors",
                "Select a color role to edit it in Oklch.",
                []Blob{
                    Container{
                        Handle: themeEditorHandle,
                        OnFocus: (_) -> themeEditorHandle.ScrollIntoView(),
                        FlexShrink: 0,
                        Gap: 10,
                        rolePills,
                        Container{
                            FlexDirection: FlexDirection.Row,
                            AlignItems: AlignItems.Center,
                            JustifyContent: JustifyContent.SpaceBetween,
                            Ui.Label(themeColorRole, p.Text, 12.5, 600),
                            Ui.Label(activeHex, p.Muted, 12),
                        },
                        Container{
                            FlexShrink: 0,
                            AlignItems: AlignItems.Center,
                            Gap: 6,
                            ThemeColorEditor.Build(
                                themeColorRole,
                                ColorMath.ParseHex(activeHex) ?? 0,
                                Math.Clamp(height - 340, 96, 176),
                                compact ? 8: 12,
                                p.Accent,
                                value -> {
                                    let color = "#" + ColorMath.Hex(value)
                                    values.SetCustomColor(themeColorRole, color)
                                    ApplyPreferences()
                                },
                            ),
                        },
                    },
                },
                p
            )
        )
    }

    private func OpacityStepperButton(symbol string, label string, disabled bool, action Action, p Palette) Blob {
        let button = Button{
            Disabled: disabled,
            DisabledStyle: Style{Opacity: .4},
            Width: 28,
            Height: 28,
            Margin: Edges{Bottom: 2},
            BorderRadius: p.ControlRadius,
            BorderWidth: 1,
            BorderColor: p.Border,
            BackgroundColor: p.Surface,
            HoverStyle: Style{BackgroundColor: p.Hover, BorderColor: p.Accent},
            FocusStyle: p.Ring(-1),
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            OnClick: action,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
            Ui.Label(symbol, p.Text, 14, 600),
        }

        WidgetKeyBindings.BindActivation(button)

        return Ui.HoverLabel(label, label, button, Host, p)
    }
}
