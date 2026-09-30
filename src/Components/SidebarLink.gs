package gloop

import Goo
import Goo.Widgets
import System

internal data struct SidebarLinkInput {
    var Icon string
    var Label string
    var Active bool
    var Action Action
    var OnContextMenu Action[Point]?
    var OnContextMenuKey Action[KeyEvent, Point]?
    var DropTarget DropTarget?
    var DropActive bool
    var Palette Palette
}

open class SidebarLink : Cell[SidebarLinkInput] {
    private let handle ElementHandle = ElementHandle()

    protected override func Build(value SidebarLinkInput) Blob {
        let p = value.Palette
        let button = Button{
            Handle: handle,
            Height: 30,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.FlexStart,
            Gap: 8,
            Padding: Edges{Left: 12, Right: 10},
            BorderRadius: 4,
            BackgroundColor: if value.Active {
                p.Selection
            } else {
                Color.Transparent
            },
            Hover: Style{BackgroundColor: p.Border},
            Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent},
            OnFocus: (_) -> handle.ScrollIntoView(),
            OnClick: value.Action,
            OnPointerUp: e -> {
                if e.Button == PointerButton.Secondary && value.OnContextMenu != nil {
                    e.PreventDefault()
                    e.StopPropagation()
                    handle.Focus()
                    value.OnContextMenu?.Invoke(e.WindowPosition)
                }
            },
            OnKeyDown: e -> {
                let bounds = handle.ContentBox
                value.OnContextMenuKey?.Invoke(e, Point{X: bounds.X, Y: bounds.Y + bounds.Height})
            },
            DropTarget: value.DropTarget,
            OutlineWidth: value.DropActive ? 1: 0,
            OutlineColor: p.Accent,
            OutlineOffset: -1,
            Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: value.Label, Selected: value.Active},
            Ui.Icon(
                value.Icon,
                if value.Active {
                    p.Accent
                } else {
                    p.Muted
                },
                19
            ),
            Ui.Label(
                value.Label,
                p.Text,
                13,
                if value.Active {
                    600
                } else {
                    400
                }
            ),
        }
        WidgetKeyBindings.BindActivation(button)
        return button
    }
}
