package gloop

import Goo
import Goo.Widgets
import System

open class ThemeColorRole : Cell[ThemeColorRoleInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value ThemeColorRoleInput) Blob {
        let p = value.Palette

        return ChoiceRow.Build(
            value.Role + " color " + value.Value,
            Ui.Label(value.Role, p.Text, 12, 500),
            Container{
                Width: 18,
                Height: 18,
                FlexShrink: 0,
                BackgroundColor: Color.Parse(value.Value),
                BorderWidth: 1,
                BorderColor: p.Border,
                BorderRadius: 3,
            },
            Ui.Label(value.Value, p.Muted, 11),
            value.Selected,
            value.Choose,
            handle,
            p,
            38,
            10
        )
    }

    shared {
        internal func Build(role string, color string, selected bool, choose Action, p Palette) Blob ->
        Cell.Mount[ThemeColorRoleInput, ThemeColorRole](
            nil,
            ThemeColorRoleInput{Role: role, Value: color, Selected: selected, Choose: choose, Palette: p}
        )
    }
}
