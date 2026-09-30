package gloop

import Goo
import System

internal data struct FilterFieldInput {
    var Value string
    var Width float64
    var Handle ElementHandle
    var Palette Palette
    var OnChange Action[string]
    var OnSubmit Action
}

open class FilterField : Cell[FilterFieldInput] {
    private var focused bool

    protected override func Build(value FilterFieldInput) Blob {
        let p = value.Palette
        return Container{
            Width: value.Width,
            Height: 32,
            HitTestSelf: true,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 7,
            Padding: Edges{Left: 10, Right: 8},
            BackgroundColor: p.Surface,
            BorderRadius: 6,
            BorderWidth: 1,
            BorderColor: focused ? p.Accent: Color.Transparent,
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
            TextEntry{
                Handle: value.Handle,
                Value: value.Value,
                Controlled: true,
                Placeholder: "Filter files",
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Height: 28,
                Color: p.Text,
                BackgroundColor: Color.Transparent,
                BorderWidth: 0,
                OutlineWidth: 0,
                FontSize: 12,
                Focus: Style{BorderWidth: 0, OutlineWidth: 0},
                Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: "Filter files"},
                OnChange: value.OnChange,
                OnSubmit: (_) -> value.OnSubmit(),
            },
        }
    }
}
