package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

internal data struct BreadcrumbInput {
    var Path string
    var Width float64
    var Window Window
    var Palette Palette
    var Navigate Action[string]
    var Edit Action
}

open class BreadcrumbBar : Cell[BreadcrumbInput] {
    private var path string = ""
    private var width float64
    private let handles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle](StringComparer.Ordinal)

    protected override func Build(value BreadcrumbInput) Blob {
        let p = value.Palette
        let changed = path != value.Path || width != value.Width
        if changed {
            path = value.Path
            width = value.Width
        }
        let segments = List[Blob]()
        var destination = "/"
        segments.Add(Segment("/", destination, value, value.Path == "/"))
        for name in value.Path.Split('/', StringSplitOptions.RemoveEmptyEntries) {
            if destination != "/" {
                let separator = Ui.Label("/", p.Muted, 12)
                separator.Key = "separator:" + destination
                segments.Add(separator)
            }
            destination = Path.Combine(destination, name)
            segments.Add(Segment(name, destination, value, destination == value.Path))
        }
        if changed && handles.TryGetValue(value.Path, out var current) {
            value.Window.Post(() -> current.ScrollIntoView())
        }
        let retained = List[string](handles.Keys)
        for destination in retained {
            if destination != "/" && !value.Path.StartsWith(destination + "/", StringComparison.Ordinal) &&
                destination != value.Path {
                handles.Remove(destination)
            }
        }
        return Container{
            Width: value.Width,
            MaxWidth: 640,
            MinWidth: 0,
            Height: 34,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: if value.Width >= 200 {
                2
            } else {
                0
            },
            Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                Height: 34,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                OverflowX: Overflow.Scroll,
                ScrollbarVisibilityX: ScrollbarVisibility.Hidden,
                Container{
                    MinWidth: Percent(100),
                    FlexShrink: 0,
                    Height: 34,
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Children: segments.ToArray(),
                },
            },
            if value.Width >= 200 {
                Ui.Tool("edit", "Edit location", value.Edit, value.Window, p)
            } else {
                Container{}
            },
        }
    }

    private func Segment(label string, destination string, value BreadcrumbInput, last bool) Blob {
        let p = value.Palette
        if !handles.TryGetValue(destination, out var handle) {
            handle = ElementHandle()
            handles[destination] = handle
        }
        let button = Button{
            Handle: handle,
            Height: 30,
            MaxWidth: Math.Min(
                200,
                value.Width - if value.Width >= 200 {
                    32
                } else {
                    0
                }
            ),
            FlexShrink: 0,
            Padding: Edges{Left: 5, Right: 5},
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BackgroundColor: Color.Transparent,
            BorderRadius: 4,
            Hover: Style{BackgroundColor: p.Surface},
            Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent, OutlineOffset: -1},
            OnFocus: (_) -> handle.ScrollIntoView(),
            OnClick: () -> value.Navigate(destination),
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Open " + destination},
            Ui.Label(label, last ? p.Text: p.Muted, 12),
        }
        WidgetKeyBindings.BindActivation(button)
        return Cell.Mount[TooltipInput, Tooltip](
            destination,
            TooltipInput{
                Window: value.Window,
                Text: destination,
                Placement: PortalPlacement.Bottom,
                Content: Text{
                    Content: destination,
                    Color: p.Text,
                    FontSize: 11,
                    MaxWidth: 320,
                    TextWrap: TextWrap.Wrap
                },
                BubbleStyle: Style{BackgroundColor: p.Surface, BorderColor: p.Border, BorderWidth: 1, Padding: 8},
                Target: button,
            }
        )
    }
}
