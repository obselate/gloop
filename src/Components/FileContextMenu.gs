package gloop

import Goo
import Goo.Widgets.Navigation
import System

open class FileContextMenu : Cell[FileContextMenuInput] {
    protected override func Build(value FileContextMenuInput) Blob {
        let p = value.Palette

        return Cell.Mount[MenuInput, Menu](
            "menu",
            MenuInput{
                Open: value.Open,
                WindowPoint: value.Point,
                Items: value.Items,
                OnClick: value.OnActivate,
                OnOpenChange: visible -> {
                    if !visible {
                        InvokeInputCallback(value.OnDismiss)
                    }
                },
                Width: 240,
                MaxHeight: 420,
                AccessibilityName: value.Name,
                ConfigureRoot: (_, root) -> {
                    root.OnPointerUp = e -> {
                        if e.Button != PointerButton.Primary {
                            e.PreventDefault()
                            e.StopPropagation()
                            value.OnDismiss()
                        }
                    }
                },
                ConfigurePanel: (_, panel) -> {
                    panel.Padding = 4
                    panel.BasedOn = p.PopupStyle()
                    panel.ScrollbarY = Ui.ScrollbarStyle(p)
                },
                ConfigureItem: (_, item, row) -> {
                    row.MinHeight = 28
                    row.Padding = Edges{Left: 8, Right: 8, Top: 4, Bottom: 4}
                    row.BorderRadius = 3
                    row.BackgroundColor = Color.Transparent
                    row.HoverStyle = Style{BackgroundColor: item.Disabled ? Color.Transparent: p.Selection}
                    row.FocusStyle = Style{BackgroundColor: p.Selection, BasedOn: p.Ring(-1)}
                },
                ConfigureSeparator: (_, _, separator) -> {
                    separator.Height = 1
                    separator.Margin = Edges{Top: 3, Bottom: 3, Left: 4, Right: 4}
                    separator.BackgroundColor = p.Border
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
        ) MenuItem {
            let content = Container{
                Opacity: disabled ? 0.45: 1,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
            }

            if icon != "" || checked {
                content.Children.Add(Ui.Icon(checked ? "check": icon, p.Text, 16))
            }

            content.Children.Add(Container{FlexGrow: 1, MinWidth: 0, Ui.Label(label, p.Text, 13)})

            if shortcut != "" {
                content.Children.Add(Ui.Label(shortcut, p.Muted, 11))
            }

            return MenuItem{Id: action, Label: label, Disabled: disabled, Content: content}
        }
    }
}
