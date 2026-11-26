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
    private let alternatingRowsHandle ElementHandle = ElementHandle()
    private let colModifiedHandle ElementHandle = ElementHandle()
    private let colCreatedHandle ElementHandle = ElementHandle()
    private let colTypeHandle ElementHandle = ElementHandle()
    private let colExtensionHandle ElementHandle = ElementHandle()
    private let colPermissionsHandle ElementHandle = ElementHandle()
    private let colSizeHandle ElementHandle = ElementHandle()
    private let shortcutFilterHandle ElementHandle = ElementHandle()
    private var shortcutFilter string = ""

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
        palette = Palette(settings.Theme, keyboardFocus, settings.RowDensity, settings.AlternatingRows)

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

    private func OpenPreferences(tab string = "Appearance") {
        if chooser != nil {
            return
        }

        preferenceInputs.Clear()
        shortcutFilter = ""
        preferenceTab = tab
        themeColorRole = "Background"
        revealThemeEditor = false
        cloudInputsLoaded = false
        cloudStatusMessage = ""
        cloudErrorMessage = ""

        OpenDialog(DialogKind.Preferences, "")
    }

    private func ResetPreferencesTab() {
        if preferenceTab == "Shortcuts" {
            settings.ResetShortcuts()
            preferenceInputs.Clear()
            shortcutFilter = ""
        } else if preferenceTab == "Layout" {
            settings.ResetViewLayout()
        } else if preferenceTab == "Behavior" {
            settings.ResetBehavior()
        } else if preferenceTab == "Cloud" {
            Model.GoogleDrive.Disconnect()
            cloudClientId = ""
            cloudClientSecret = ""
            cloudApiKey = ""
            cloudRootFolderId = "root"
            Model.GoogleDrive.UpdateSettings("", "", "", "root")
            cloudStatusMessage = "Disconnected and cleared Google Drive credentials."
            cloudErrorMessage = ""
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
        } else if preferenceTab == "Layout" {
            LayoutRows(rows, values, p)
        } else if preferenceTab == "Behavior" {
            BehaviorRows(rows, values, p)
        } else if preferenceTab == "Cloud" {
            CloudRows(rows, p)
        } else {
            AppearanceRows(rows, values, p, compact)
        }

        let detail = DialogShell.ScrollColumn(rows.ToArray(), p, gap: 12)
        detail.FlexGrow = 1
        detail.FlexBasis = 0

        if width < 660 {
            return Container{MinHeight: 0, FlexShrink: 1, Gap: compact ? 8: 12, PreferenceTabStrip(p), detail,}
        }

        return Container{
            MinHeight: 0,
            FlexShrink: 1,
            FlexDirection: FlexDirection.Row,
            Gap: 14,
            PreferenceNavSidebar(p),
            Container{Width: 1, FlexShrink: 0, BackgroundColor: p.Border},
            detail,
        }
    }

    private func PreferenceNavSidebar(p Palette) Blob {
        let items = List[Blob]()
        let tabs = []string{"Appearance", "Layout", "Behavior", "Cloud", "Shortcuts"}
        let icons = []string{"palette", "view_column", "tune", "cloud", "keyboard"}

        for index in 0 ... tabs.Length {
            let tab = tabs[index]
            let icon = icons[index]
            let active = preferenceTab == tab

            items.Add(
                Button{
                    Height: 34,
                    Padding: Edges{Left: 10, Right: 10},
                    BorderRadius: p.ControlRadius,
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.FlexStart,
                    Gap: 9,
                    BackgroundColor: active ? p.Selection: Color.Transparent,
                    HoverStyle: Style{BackgroundColor: active ? p.Selection: p.Hover},
                    FocusStyle: p.Ring(-1),
                    OnClick: () -> SelectPreferenceTab(tab),
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: tab},
                    Ui.Icon(icon, active ? p.Accent: p.Muted, 17),
                    Ui.Label(tab, p.Text, 13, active ? 600: 400),
                }
            )
        }

        return Container{Width: 156, FlexShrink: 0, Gap: 4, Children: items.ToArray(),}
    }

    private func PreferenceTabStrip(p Palette) Blob {
        let tabs = Container{FlexDirection: FlexDirection.Row, Gap: 6}

        for name in[]string{"Appearance", "Layout", "Behavior", "Cloud", "Shortcuts"} {
            let tab = name
            let button = DialogButton(tab, () -> SelectPreferenceTab(tab), p, preferenceTab == tab)
            button.FlexGrow = 1
            button.FlexBasis = 0
            button.Padding = Edges{Left: 6, Right: 6}
            tabs.Children.Add(button)
        }

        return tabs
    }

    private func SelectPreferenceTab(tab string) {
        CommitPreferenceBindings()
        preferenceTab = tab
        Rebuild()
    }

    private func LayoutRows(rows List[Blob], values AppSettings, p Palette) {
        let densityButtons = Container{FlexDirection: FlexDirection.Row, Gap: 6}
        let densities = []RowDensity{RowDensity.Compact, RowDensity.Comfortable, RowDensity.Spacious}
        let labels = []string{"Compact", "Comfortable", "Spacious"}
        let specs = []string{"26 px · 12 pt", "32 px · 13 pt", "38 px · 14 pt"}

        for index in 0 ... densities.Length {
            let density = densities[index]
            let active = values.RowDensity == density
            densityButtons.Children.Add(
                Button{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    Padding: Edges{Left: 8, Right: 8, Top: 8, Bottom: 8},
                    BorderRadius: p.ControlRadius,
                    BorderWidth: 1,
                    BorderColor: active ? p.Accent: p.Border,
                    BackgroundColor: active ? p.Selection: p.Surface,
                    HoverStyle: Style{BackgroundColor: active ? p.Selection: p.Hover},
                    FocusStyle: p.Ring(-1),
                    AlignItems: AlignItems.Center,
                    Gap: 2,
                    OnClick: () -> {
                        values.RowDensity = density
                        ApplyPreferences()
                    },
                    Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: labels[index] + " row density"},
                    Ui.Label(labels[index], active ? p.Text: p.Muted, 12.5, active ? 600: 500),
                    Ui.Label(specs[index], p.Muted, 10.5),
                }
            )
        }

        rows.Add(
            Ui.SectionCard(
                "Typography & Row Density",
                "Controls list row height, icon sizing, and base file label size.",
                []Blob{
                    densityButtons,
                    PreferenceRow.Toggle(
                        "Alternating row shading",
                        values.AlternatingRows,
                        () -> {
                            values.AlternatingRows = !values.AlternatingRows
                            ApplyPreferences()
                        },
                        alternatingRowsHandle,
                        p
                    ),
                },
                p
            )
        )

        rows.Add(
            Ui.SectionCard(
                "Visible Columns",
                "Choose which metadata columns appear in List view. Right-click any column header to toggle quickly.",
                []Blob{
                    ColumnToggleRow(
                        "Modified",
                        values.ShowModifiedColumn,
                        colModifiedHandle,
                        () -> {
                            values.ShowModifiedColumn = !values.ShowModifiedColumn
                            ApplyPreferences()
                        },
                        p
                    ),
                    ColumnToggleRow(
                        "Created",
                        values.ShowCreatedColumn,
                        colCreatedHandle,
                        () -> {
                            values.ShowCreatedColumn = !values.ShowCreatedColumn
                            ApplyPreferences()
                        },
                        p
                    ),
                    ColumnToggleRow(
                        "Type",
                        values.ShowTypeColumn,
                        colTypeHandle,
                        () -> {
                            values.ShowTypeColumn = !values.ShowTypeColumn
                            ApplyPreferences()
                        },
                        p
                    ),
                    ColumnToggleRow(
                        "Extension",
                        values.ShowExtensionColumn,
                        colExtensionHandle,
                        () -> {
                            values.ShowExtensionColumn = !values.ShowExtensionColumn
                            ApplyPreferences()
                        },
                        p
                    ),
                    ColumnToggleRow(
                        "Permissions",
                        values.ShowPermissionsColumn,
                        colPermissionsHandle,
                        () -> {
                            values.ShowPermissionsColumn = !values.ShowPermissionsColumn
                            if values.ShowPermissionsColumn {
                                Model.Directories.RefreshLoadedPanes()
                            }
                            ApplyPreferences()
                        },
                        p
                    ),
                    ColumnToggleRow(
                        "Size",
                        values.ShowSizeColumn,
                        colSizeHandle,
                        () -> {
                            values.ShowSizeColumn = !values.ShowSizeColumn
                            ApplyPreferences()
                        },
                        p
                    ),
                },
                p
            )
        )
    }

    private func ColumnToggleRow(
        label string,
        enabled bool,
        handle ElementHandle,
        toggle Action,
        p Palette
    ) Blob -> PreferenceRow.Toggle(label, enabled, toggle, handle, p)

    private func BehaviorRows(rows List[Blob], values AppSettings, p Palette) {
        rows.Add(
            Ui.SectionCard(
                "Scrolling",
                "Adjust wheel smoothing and scroll distance per notch.",
                []Blob{
                    PreferenceRow.Toggle(
                        "Smooth scrolling",
                        values.SmoothScrolling,
                        () -> {
                            values.SmoothScrolling = !values.SmoothScrolling
                            ApplyPreferences()
                        },
                        smoothScrollingRow,
                        p
                    ),
                    PreferenceRow.Slider(
                        "scroll-speed",
                        SliderInput{
                            Value: values.ScrollSpeed,
                            Minimum: AppSettings.MinimumScrollSpeed,
                            Maximum: AppSettings.MaximumScrollSpeed,
                            Step: .25,
                            Label: "Scroll speed",
                            ShowValue: true,
                            FormatValue: value -> value.ToString("0.##", CultureInfo.InvariantCulture) + "×",
                            OnChange: value -> {
                                values.ScrollSpeed = value
                                ApplyPreferences()
                            },
                        },
                        scrollSpeedRow,
                        p
                    ),
                },
                p
            )
        )

        rows.Add(
            Ui.SectionCard(
                "Preview",
                "Configure text and code preview rendering.",
                []Blob{
                    PreferenceRow.Toggle(
                        "Wrap text previews",
                        values.PreviewWordWrap,
                        () -> {
                            values.PreviewWordWrap = !values.PreviewWordWrap
                            ApplyPreferences()
                        },
                        previewWordWrapRow,
                        p
                    ),
                    PreferenceRow.Toggle(
                        "Show preview line numbers",
                        values.PreviewLineNumbers,
                        () -> {
                            values.PreviewLineNumbers = !values.PreviewLineNumbers
                            ApplyPreferences()
                        },
                        previewLineNumbersRow,
                        p
                    ),
                },
                p
            )
        )

        rows.Add(
            Ui.SectionCard(
                "Desktop Integration",
                "Configure launcher icon, default file manager, and file chooser portal.",
                []Blob{
                    PreferenceRow.Build(
                        "Run desktop setup wizard",
                        DialogButton("Desktop setup", () -> OpenSetup(), p),
                        p
                    ),
                },
                p
            )
        )
    }

    private func ShortcutRows(rows List[Blob], values AppSettings, p Palette) {
        let query = shortcutFilter.Trim()
        let filterField = TextField
            .Build(
            shortcutFilter,
            value -> {
                shortcutFilter = value
                Rebuild()
            },
            (_) -> { },
            "Filter shortcuts",
            p,
            handle: shortcutFilterHandle,
            fontSize: 12
        ){.Placeholder: "Filter shortcuts by action or key…"}

        rows.Add(
            Container{
                Gap: 6,
                filterField,
                Text{
                    Content: "Press Enter or leave a field to apply a shortcut, such as Ctrl+S.",
                    Color: p.Muted,
                    FontSize: 11.5,
                    TextWrap: TextWrap.Wrap,
                },
            }
        )

        for pair in values.Keybindings {
            let action = pair.Key
            let label = AppSettings.ActionCatalog[action].Label
            let input = preferenceInputs.TryGetValue(action, out var typed) ? typed: pair.Value

            if query != "" && !label.Contains(query, StringComparison.OrdinalIgnoreCase)
            && !input.Contains(query, StringComparison.OrdinalIgnoreCase) {
                continue
            }

            rows.Add(
                PreferenceRow(
                    label,
                    input,
                    value -> SetPreferenceBinding(action, value),
                    () -> CommitPreferenceBinding(action),
                    p,
                    values.ValidateBinding(action, input) != ""
                )
            )
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
            150,
            handle,
            fontSize: 12,
            padding: 10
        )
        field.OnFocus = (_) -> handle.ScrollIntoView()
        field.OnBlur = (_) -> commit()

        return PreferenceRow.Build(label, field, p)
    }
}
