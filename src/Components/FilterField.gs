package gloop

import Goo
import System

open class FilterField : Cell[FilterFieldInput] {
    private var focused bool

    protected override func Build(value FilterFieldInput) Blob {
        let p = value.Palette
        let active = value.Value != ""
        let entry = TextField
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
            .Height: 26,
            .Padding: 0,
            .BackgroundColor: Color.Transparent,
            .BorderWidth: 0,
            .OutlineWidth: 0,
            .FocusStyle: Style{BorderWidth: 0, OutlineWidth: 0},
            .OnKeyDown: e -> {
                if e.Key == Key.Down {
                    value.OnMoveSelection(1)
                    e.PreventDefault()
                    e.StopPropagation()
                } else if e.Key == Key.Up {
                    value.OnMoveSelection(-1)
                    e.PreventDefault()
                    e.StopPropagation()
                } else if e.Key == Key.Escape {
                    if value.Value != "" {
                        value.OnClear()
                    } else {
                        value.OnSubmit()
                    }
                    e.PreventDefault()
                    e.StopPropagation()
                }
            },
        }

        let root = Container{
            Width: value.Width,
            Height: 30,
            BackgroundColor: p.SubtleSurface,
            BorderWidth: 1,
            BorderColor: focused || active ? p.Accent: p.Border,
            BorderRadius: p.ControlRadius,
            HitTestSelf: true,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            Padding: Edges{Left: 9, Right: active ? 4: 8},
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
            Ui.Icon("search", active ? p.Accent: p.Muted, 15),
            entry,
        }

        if active {
            let countColor = value.MatchCount == 0 ? p.Error: p.Muted
            root.Children.Add(
                Container{
                    FlexShrink: 0,
                    Padding: Edges{Left: 5, Right: 5, Top: 2, Bottom: 2},
                    BorderRadius: Math.Max(2, p.ControlRadius - 2),
                    BackgroundColor: p.Hover,
                    Ui.Label(value.MatchCount.ToString() + "/" + value.TotalCount.ToString(), countColor, 10.5, 500),
                }
            )
            root.Children.Add(
                Ui.Tool(
                    "close",
                    "Clear filter",
                    value.OnClear,
                    value.Window,
                    p,
                    size: 22,
                    iconSize: 14,
                    shortcut: "Escape"
                )
            )
        }

        return root
    }
}
