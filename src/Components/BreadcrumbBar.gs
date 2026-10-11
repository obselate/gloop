package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

internal data struct BreadcrumbInput {
    var Path string
    var Home string
    var Width float64
    var Window Window
    var Palette Palette
    var Navigate Action[string]
    var Edit Action
    var More Action[[]string, Point]
}

open class BreadcrumbBar : Cell[BreadcrumbInput] {
    private const SeparatorWidth float64 = 12
    private const MoreWidth float64 = 28
    private const EditWidth float64 = 32
    private let handles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle](StringComparer.Ordinal)
    private let widths Dictionary[string, float64] = Dictionary[string, float64](StringComparer.Ordinal)
    private let more ElementHandle = ElementHandle()

    protected override func Build(value BreadcrumbInput) Blob {
        let p = value.Palette
        let names = List[string]()
        let paths = List[string]()
        var destination = "/"
        var rest = value.Path
        if value
            .Home
            .Length > 1 &&
            (value.Path == value.Home || value.Path.StartsWith(value.Home + "/", StringComparison.Ordinal)) {
            destination = value.Home
            rest = value.Path.Substring(value.Home.Length)
            names.Add("Home")
        } else {
            names.Add("/")
        }
        paths.Add(destination)
        for name in rest.Split('/', StringSplitOptions.RemoveEmptyEntries) {
            destination = Path.Combine(destination, name)
            names.Add(name)
            paths.Add(destination)
        }
        for known in List[string](handles.Keys) {
            if !paths.Contains(known) {
                handles.Remove(known)
                widths.Remove(known)
            }
        }
        let editable = value.Width >= 160
        let available = value.Width - (editable ? EditWidth: 0)
        var total = (names.Count - 1) * SeparatorWidth
        for index in 0 ... names.Count {
            total += SegmentWidth(names[index], paths[index])
        }
        var first = 0
        while first < names.Count - 1 && total + (first > 0 ? MoreWidth + SeparatorWidth: 0) > available {
            total -= SegmentWidth(names[first], paths[first]) + SeparatorWidth
            first++
        }
        let children = List[Blob]()
        if first > 0 {
            let hidden = paths.GetRange(0, first).ToArray()
            let button = Button{
                Key: "more",
                Handle: more,
                Width: MoreWidth,
                Height: 26,
                FlexShrink: 0,
                Padding: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BackgroundColor: p.Surface,
                BorderRadius: 4,
                Hover: Style{BackgroundColor: p.Border},
                Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent, OutlineOffset: -1},
                OnClick: () -> value.More(
                    hidden,
                    Point{X: more.BorderBox.X, Y: more.BorderBox.Y + more.BorderBox.Height + 2}
                ),
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Show parent folders"},
                Ui.Label("…", p.Muted, 12),
            }
            WidgetKeyBindings.BindActivation(button)
            children.Add(button)
        }
        for index in first ... names.Count {
            if index > 0 {
                children.Add(
                    Container{
                        Key: "separator:" + paths[index],
                        Width: SeparatorWidth,
                        FlexShrink: 0,
                        AlignItems: AlignItems.Center,
                        Ui.Label("/", p.Muted, 12),
                    }
                )
            }
            children.Add(
                Segment(
                    names[index],
                    paths[index],
                    value,
                    index == names.Count - 1,
                    available - (first > 0 ? MoreWidth + SeparatorWidth: 0),
                    first == names.Count - 1
                )
            )
        }
        if editable {
            let edit = Ui.Tool("edit", "Edit location", value.Edit, value.Window, p)
            edit.Key = "edit"
            edit.Margin = Edges{Left: 2}
            children.Add(edit)
        }
        return Container{
            Width: value.Width,
            MinWidth: 0,
            Height: 30,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            OverflowX: Overflow.Hidden,
            Children: children.ToArray(),
        }
    }

    private func SegmentWidth(name string, destination string) float64 -> if widths.TryGetValue(
        destination,
        out var known
    ) {
        known
    } else {
        Math.Min(220, name.Length * 7 + 10)
    }

    private func Segment(
        label string,
        destination string,
        value BreadcrumbInput,
        last bool,
        room float64,
        alone bool
    ) Blob {
        let p = value.Palette
        if !handles.TryGetValue(destination, out var handle) {
            handle = ElementHandle()
            handles[destination] = handle
            handle.MetricsChanged += (metrics) -> {
                if !metrics.IsMounted {
                    return
                }
                let measured = metrics.BorderBox.Width
                if !widths.TryGetValue(destination, out var known) || Math.Abs(known - measured) > .5 {
                    widths[destination] = measured
                    Rebuild()
                }
            }
        }
        let button = Button{
            Handle: handle,
            Height: 26,
            MinWidth: 0,
            MaxWidth: last ? Math.Max(0, room): 220,
            FlexShrink: alone ? 1: 0,
            Padding: Edges{Left: 5, Right: 5},
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BackgroundColor: Color.Transparent,
            BorderRadius: 4,
            Hover: Style{BackgroundColor: p.Surface},
            Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent, OutlineOffset: -1},
            OnClick: () -> value.Navigate(destination),
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Open " + destination},
            Ui.Label(label, last ? p.Text: p.Muted, 13, last ? 600: 400),
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
