package gloop

import Goo
import System

open class FilterField : Cell[FilterFieldInput] {
    private var focused bool

    protected override func Build(value FilterFieldInput) Blob {
        let p = value.Palette
        return Container{
            Width: value.Width,
            BasedOn: TextField.FieldStyle(p),
            HitTestSelf: true,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 7,
            Padding: Edges{Left: 10, Right: 8},
            BorderColor: focused ? p.Accent: p.Border,
            OnFocus: (_) -> {
                focused = true
                Rebuild()
            },
            OnBlur: (_) -> {
                focused = false
                Rebuild()
            },
            OnPointerDown: e -> {
                if e.Button == PointerButton.Primary && !e.IsFromInteractiveChild {
                    value.Handle.Focus()
                    e.PreventDefault()
                }
            },
            Ui.Icon("search", p.Muted, 16),
            TextField
                .Build(
                value.Value,
                value.OnChange,
                (_) -> value.OnSubmit(),
                "Filter files",
                p,
                handle: value.Handle,
                fontSize: 12
            ){
                .Placeholder: "Filter files",
                .FlexGrow: 1,
                .FlexBasis: 0,
                .Height: TextField.Height - 4,
                .Padding: 0,
                .BackgroundColor: Color.Transparent,
                .BorderWidth: 0,
                .OutlineWidth: 0,
                .Focus: Style{BorderWidth: 0, OutlineWidth: 0},
            },
        }
    }
}
