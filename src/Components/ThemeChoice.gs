package gloop

import Goo
import Goo.Widgets
import System

internal data struct ThemeChoiceInput {
    var Name string
    var Theme ThemePalette
    var Selected bool
    var Keyboard bool
    var Choose Action
}

open class ThemeChoice : Cell[ThemeChoiceInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value ThemeChoiceInput) Blob -> Choice(
        value.Name,
        value.Theme,
        value.Selected,
        value.Keyboard,
        value.Choose
    )

    shared {
        internal func Build(name string, theme ThemePalette, selected bool, keyboard bool, choose Action) Blob -> Cell
            .Mount[ThemeChoiceInput, ThemeChoice](
            nil,
            ThemeChoiceInput{Name: name, Theme: theme, Selected: selected, Keyboard: keyboard, Choose: choose,}
        )
    }

    private func Choice(name string, theme ThemePalette, selected bool, keyboard bool, choose Action) Blob {
        let p = Palette(theme, keyboard)
        let button = Button{
            Handle: handle,
            Height: 44,
            FlexShrink: 0,
            MinWidth: 0,
            Padding: Edges{Left: 10, Right: 10},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            BorderWidth: 1,
            BorderRadius: 4,
            BorderColor: if selected {
                p.Accent
            } else {
                p.Border
            },
            BackgroundColor: p.Background,
            Hover: Style{BorderColor: p.Accent},
            Focus: p.Ring(),
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
            Preview(p),
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    private func Preview(p Palette) Blob {
        let frame = Container{
            Width: 76,
            Height: 30,
            FlexShrink: 0,
            BorderWidth: 1,
            BorderColor: p.Border,
            BorderRadius: 4,
            Overflow: Overflow.Hidden,
            Container{
                FlexGrow: 1,
                FlexDirection: FlexDirection.Row,
                BackgroundColor: p.Window,
                Container{Width: 18, BackgroundColor: p.Sidebar},
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    Padding: Edges{Left: 5, Right: 5},
                    Gap: 3,
                    JustifyContent: JustifyContent.Center,
                    Mark(p.Muted, 3),
                    Mark(p.Accent, 3),
                    Container{
                        FlexDirection: FlexDirection.Row,
                        Gap: 3,
                        Mark(p.Keyword, 5),
                        Mark(p.String, 5),
                        Mark(p.Number, 5),
                        Mark(p.Type, 5),
                    },
                },
            },
        }
        if p.Glass {
            frame.BackgroundGradient = LinearGradient(Color.Parse("#2B6FD6"), Color.Parse("#D43C8C"))
        }
        return frame
    }

    private func Mark(color Color, size float64) Blob -> Container{
        Width: size == 3 ? Percent(100): size,
        Height: size,
        FlexShrink: 0,
        BackgroundColor: color,
        BorderRadius: 3,
    }
}
