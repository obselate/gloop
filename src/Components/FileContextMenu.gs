package gloop

import Goo
import Goo.Widgets.Navigation
import System

internal data struct FileContextMenuInput {
    var Open bool
    var Point Point
    var Name string
    var Items[]MenuItem
    var OnActivate Action[string]
    var OnDismiss Action
    var Palette Palette
}

open class FileContextMenu : Cell[FileContextMenuInput] {
    protected override func Build(value FileContextMenuInput) Blob {
        let p = value.Palette
        return Cell.Mount[MenuInput, Menu](
            "menu",
            MenuInput{
                Open: value.Open,
                WindowPoint: value.Point,
                Items: value.Items,
                OnActivate: value.OnActivate,
                OnDismiss: value.OnDismiss,
                Width: 240,
                MaxHeight: 340,
                AccessibilityName: value.Name,
                CreatePanel: (_, panel) -> {
                    panel.Padding = 4
                    panel.BackgroundColor = p.Background
                    panel.BorderColor = p.Border
                    panel.BorderRadius = 5
                    panel.ScrollbarY = Ui.ScrollbarStyle(p)
                    return panel
                },
                CreateItem: (_, item, row) -> {
                    row.MinHeight = 28
                    row.Padding = Edges{Left: 8, Right: 8, Top: 4, Bottom: 4}
                    row.BorderRadius = 3
                    row.BackgroundColor = Color.Transparent
                    row.Hover = Style{BackgroundColor: item.Disabled ? Color.Transparent: p.Selection}
                    row.Focus = Style{
                        BackgroundColor: p.Selection,
                        OutlineWidth: 1,
                        OutlineColor: p.Accent,
                        OutlineOffset: -1,
                    }
                    return row
                },
                CreateSeparator: (_, _) -> Container{
                    Height: 1,
                    Margin: Edges{Top: 3, Bottom: 3, Left: 4, Right: 4},
                    BackgroundColor: p.Border,
                },
            }
        )
    }

    shared {
        internal func Item(
            action string,
            label string,
            icon string,
            shortcut string,
            p Palette,
            disabled bool = false,
            checked bool = false
        ) MenuItem -> MenuItem{
            Id: action,
            Label: label,
            Disabled: disabled,
            Content: Container{
                Opacity: disabled ? 0.45: 1,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Ui.Icon(checked ? "check": icon, p.Text, 16),
                Container{FlexGrow: 1, MinWidth: 0, Ui.Label(label, p.Text, 13)},
                Ui.Label(shortcut, p.Muted, 11),
            },
        }
    }
}
