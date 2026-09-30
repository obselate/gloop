package gloop

import Goo
import Goo.Widgets
import System

internal data struct ThemeChoiceInput {
    var Name string
    var Theme ThemePalette
    var Selected bool
    var Choose Action
}

open class ThemeChoice : Cell[ThemeChoiceInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value ThemeChoiceInput) Blob -> Choice(
        value.Name,
        value.Theme,
        value.Selected,
        value.Choose
    )

    shared {
        internal func Build(name string, theme ThemePalette, selected bool, choose Action) Blob -> Cell.Mount[
            ThemeChoiceInput,
            ThemeChoice
        ](nil, ThemeChoiceInput{Name: name, Theme: theme, Selected: selected, Choose: choose,})
    }

    private func Choice(name string, theme ThemePalette, selected bool, choose Action) Blob {
        let p = Palette(theme)
        let button = Button{
            Handle: handle,
            Height: 52,
            FlexShrink: 0,
            MinWidth: 0,
            Padding: Edges{Left: 12, Right: 12},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            BorderWidth: 1,
            BorderRadius: 4,
            BorderColor: if selected {
                p.Accent
            } else {
                p.Border
            },
            BackgroundColor: p.Background,
            Hover: Style{BorderColor: p.Accent},
            Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent},
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: name, Selected: selected},
            OnClick: choose,
            OnFocus: (_) -> handle.ScrollIntoView(),
            Container{
                Width: 20,
                FlexShrink: 0,
                if selected {
                    Ui.Icon("check", p.Accent, 18)
                } else {
                    Container{}
                },
            },
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(name, p.Text, 13, 500)},
            Swatch(p.Surface, p.Border),
            Swatch(p.Selection, p.Border),
            Swatch(p.Accent, p.Border),
            Swatch(p.Text, p.Border),
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Swatch(color Color, border Color) Blob -> Container{
        Width: 16,
        Height: 16,
        FlexShrink: 0,
        BackgroundColor: color,
        BorderWidth: 1,
        BorderColor: border,
        BorderRadius: 3,
    }
}
