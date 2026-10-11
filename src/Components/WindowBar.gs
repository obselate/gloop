package gloop

import Goo
import Goo.Widgets.Layout
import System

class WindowBar {
    shared {
        internal func Build(window Window, toolbar Blob, width float64, p Palette) Blob -> WindowChrome{
            Host: window,
            LeadingContent: Container{Width: Math.Max(0, width - 108), toolbar},
            Height: 40,
            ControlWidth: 36,
            BackgroundColor: p.Bar,
            BorderColor: p.Border,
            ControlColor: p.Muted,
            HoverBackgroundColor: p.Border,
            EnableDoubleClick: true,
            CreateControlContent: (_, command) -> {
                let name = command.ToString()
                let icon = switch command {
                    case WindowChromeAction.Minimize: "remove"
                    case WindowChromeAction.Maximize: "crop_square"
                    case WindowChromeAction.Restore: "filter_none"
                    default: "close"
                }
                return Cell.Mount[TooltipInput, Tooltip](
                    name,
                    TooltipInput{
                        Window: window,
                        Content: Ui.Label(name, p.Text, 11),
                        Placement: PortalPlacement.Bottom,
                        BubbleStyle: Ui.BubbleStyle(p),
                        Target: Container{
                            Width: 36,
                            Height: 40,
                            HitTestSelf: true,
                            AlignItems: AlignItems.Center,
                            JustifyContent: JustifyContent.Center,
                            Ui.Icon(icon, p.Muted, 18),
                        },
                    }
                )
            },
            CreateControl: (_, command, _, _) -> Button{
                Width: 36,
                Height: 40,
                Padding: 0,
                BackgroundColor: Color.Transparent,
                Hover: Style{
                    BackgroundColor: if command == WindowChromeAction.Close {
                        Color.Parse("#9F3545")
                    } else {
                        p.Border
                    }
                },
                Focus: Style{OutlineWidth: 1, OutlineColor: p.Accent, OutlineOffset: -2},
            },
        }.Build()
    }
}
