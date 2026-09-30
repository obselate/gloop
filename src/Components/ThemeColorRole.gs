package gloop

import Goo
import Goo.Widgets
import System

internal data struct ThemeColorRoleInput {
    var Role string
    var Value string
    var Selected bool
    var Choose Action
    var Palette Palette
}

open class ThemeColorRole : Cell[ThemeColorRoleInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value ThemeColorRoleInput) Blob {
        let p = value.Palette
        let button = Button{
            Handle: handle,
            Height: 38,
            FlexShrink: 0,
            MinWidth: 0,
            Padding: Edges{Left: 10, Right: 10},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
            BorderWidth: 1,
            BorderRadius: 4,
            BorderColor: if value.Selected {
                p.Accent
            } else {
                p.Border
            },
            BackgroundColor: p.Background,
            Hover: Style{BorderColor: p.Accent},
            Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent},
            Accessibility: Accessibility{
                Role: AccessibilityRole.Button,
                Name: value.Role + " color " + value.Value,
                Selected: value.Selected,
            },
            OnClick: value.Choose,
            OnFocus: (_) -> handle.ScrollIntoView(),
            Container{
                Width: 18,
                Height: 18,
                FlexShrink: 0,
                BackgroundColor: Color.Parse(value.Value),
                BorderWidth: 1,
                BorderColor: p.Border,
                BorderRadius: 3,
            },
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(value.Role, p.Text, 12, 500)},
            Ui.Label(value.Value, p.Muted, 11),
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }

    shared {
        internal func Build(role string, color string, selected bool, choose Action, p Palette) Blob ->
        Cell.Mount[ThemeColorRoleInput, ThemeColorRole](
            nil,
            ThemeColorRoleInput{Role: role, Value: color, Selected: selected, Choose: choose, Palette: p}
        )
    }
}
