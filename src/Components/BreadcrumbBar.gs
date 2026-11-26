package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

open class BreadcrumbBar : Cell[BreadcrumbInput] {
    private const SeparatorWidth float64 = 12
    private const MoreWidth float64 = 28
    private let handles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle](StringComparer.Ordinal)
    private let widths Dictionary[string, float64] = Dictionary[string, float64](StringComparer.Ordinal)
    private let more ElementHandle = ElementHandle()

    protected override func Build(value BreadcrumbInput) Blob {
        let p = value.Palette
        let names = List[string]()
        let paths = List[string]()
        BuildSegments(value, names, paths)

        for known in List[string](handles.Keys) {
            if !paths.Contains(known) {
                handles.Remove(known)
                widths.Remove(known)
            }
        }

        let editable = value.Width >= 160
        let available = value.Width - 28
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

        children.Add(
            Container{
                Key: "root-icon",
                Width: 20,
                Height: 20,
                FlexShrink: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                Ui.Icon(RootIcon(value.Kind), p.Muted, 15),
            }
        )

        if first > 0 {
            let hidden = paths.GetRange(0, first).ToArray()
            let button = Button{
                Handle: more,
                Width: MoreWidth,
                Height: 22,
                FlexShrink: 0,
                Padding: 0,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BackgroundColor: p.Hover,
                BorderRadius: Math.Max(2, p.ControlRadius - 2),
                HoverStyle: Style{BackgroundColor: p.Border},
                FocusStyle: p.Ring(-1),
                OnClick: () -> value.More(
                    hidden,
                    Point{X: more.BorderBox.X, Y: more.BorderBox.Y + more.BorderBox.Height + 2}
                ),
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Show parent folders"},
                Ui.Label("…", p.Muted, 12),
            }

            WidgetKeyBindings.BindActivation(button)
            children.Add(Ui.HoverLabel("more", "Show parent folders", button, value.Window, p))
        }

        for index in first ... names.Count {
            if index > 0 {
                children.Add(
                    Container{
                        Key: "separator:" + paths[index],
                        Width: SeparatorWidth,
                        FlexShrink: 0,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        Ui.Icon("chevron_right", p.Muted.WithAlpha(.7), 14),
                    }
                )
            }

            children.Add(
                Segment(
                    names[index],
                    paths[index],
                    value,
                    index == names.Count - 1,
                    available - (first > 0 ? MoreWidth + SeparatorWidth: 0) - 24,
                    first == names.Count - 1
                )
            )
        }

        if editable {
            let blank = Container{
                Key: "edit-blank",
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 12,
                Height: 26,
                HitTestSelf: true,
                OnPointerDown: e -> {
                    if e.Button == PointerButton.Primary {
                        value.Edit()
                        e.PreventDefault()
                    }
                },
            }
            children.Add(
                Ui.HoverLabel(
                    "edit-blank-tip",
                    "Click to edit location",
                    blank,
                    value.Window,
                    p,
                    shortcut: value.EditShortcut
                )
            )
        }

        return Container{
            Width: value.Width,
            MinWidth: 0,
            Height: 30,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Padding: Edges{Left: 6, Right: 6},
            Gap: 1,
            HitTestSelf: true,
            OnPointerDown: e -> {
                if editable && e.Button == PointerButton.Primary && !e.IsFromInteractiveChild {
                    value.Edit()
                    e.PreventDefault()
                }
            },
            BackgroundColor: p.SubtleSurface,
            BorderWidth: 1,
            BorderColor: p.Border,
            BorderRadius: p.ControlRadius,
            HoverStyle: Style{BorderColor: p.Muted.WithAlpha(.45)},
            OverflowX: Overflow.Hidden,
            Children: children.ToArray(),
        }
    }

    private func RootIcon(kind LocationKind) string -> switch kind {
        case LocationKind.Recent: "history"
        case LocationKind.Trash: "delete"
        case LocationKind.Archive: "folder_zip"
        default: "folder"
    }

    private func BuildSegments(value BreadcrumbInput, names List[string], paths List[string]) {
        var destination = "/"
        var rest = value.Path

        if value.Kind == LocationKind.Recent {
            destination = Locations.Recent
            rest = ""
            names.Add("Recent")
        } else if value.Kind == LocationKind.Trash {
            destination = value.Trash
            rest = value.Path.Substring(value.Trash.Length)
            names.Add("Trash")
        } else if value
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
            Height: 22,
            MinWidth: 0,
            MaxWidth: last ? Math.Max(0, room): 220,
            FlexShrink: alone ? 1: 0,
            Padding: Edges{Left: 6, Right: 6},
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            BackgroundColor: Color.Transparent,
            BorderRadius: Math.Max(2, p.ControlRadius - 2),
            HoverStyle: Style{BackgroundColor: p.Hover},
            FocusStyle: p.Ring(-1),
            OnClick: () -> value.Navigate(destination),
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: "Open " + destination},
            Ui.Label(label, last ? p.Text: p.Muted, p.SecondaryFontSize, last ? 600: 400),
        }

        WidgetKeyBindings.BindActivation(button)

        return Ui.HoverLabel(destination, destination, button, value.Window, p, wrap: true)
    }
}
