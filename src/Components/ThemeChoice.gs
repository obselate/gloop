package gloop

import Goo
import Goo.Widgets
import System

open class ThemeChoice : Cell[ThemeChoiceInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value ThemeChoiceInput) Blob {
        let p = Palette(value.Theme, value.Keyboard)
        return ChoiceRow.Build(
            value.Name,
            Ui.Label(value.Name, p.Text, 13, 500),
            Container{
                Width: 20,
                FlexShrink: 0,
                if value.Selected {
                    Ui.Icon("check", p.Accent, 18)
                } else {
                    Container{}
                },
            },
            Preview(p),
            value.Selected,
            value.Choose,
            handle,
            p,
            44,
            6
        )
    }

    shared {
        internal func Build(name string, theme ThemePalette, selected bool, keyboard bool, choose Action) Blob -> Cell
            .Mount[ThemeChoiceInput, ThemeChoice](
            nil,
            ThemeChoiceInput{Name: name, Theme: theme, Selected: selected, Keyboard: keyboard, Choose: choose,}
        )
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
            frame.BackgroundGradient = p.GlassGradient
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
