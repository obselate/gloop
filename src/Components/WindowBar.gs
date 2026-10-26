package gloop

import Goo
import Goo.Widgets.Layout
import System

class WindowBar {
    shared {
        internal const ControlWidth float64 = 36

        internal func Build(window Window, toolbar Blob, width float64, p Palette) Blob -> WindowChrome{
            Host: window,
            LeadingContent: Container{Width: Math.Max(0, width - 3 * ControlWidth), toolbar},
            Height: Ui.BarHeight,
            ControlWidth: ControlWidth,
            BackgroundColor: p.Bar,
            ControlColor: p.Muted,
            HoverBackgroundColor: p.ChromeHover,
            EnableDoubleClick: true,
            CreateControlContent: (_, command) -> {
                let name = command.ToString()
                let icon = switch command {
                    case WindowChromeAction.Minimize: "remove"
                    case WindowChromeAction.Maximize: "crop_square"
                    case WindowChromeAction.Restore: "filter_none"
                    default: "close"
                }
                return Ui.HoverLabel(
                    name,
                    name,
                    Container{
                        Width: ControlWidth,
                        Height: Ui.BarHeight,
                        HitTestSelf: true,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        Ui.Icon(icon, p.Muted, 18),
                    },
                    window,
                    p
                )
            },
            CreateControl: (_, command, _, _) -> Button{
                Width: ControlWidth,
                Height: Ui.BarHeight,
                Padding: 0,
                BackgroundColor: Color.Transparent,
                Hover: Style{
                    BackgroundColor: if command == WindowChromeAction.Close {
                        p.Danger
                    } else {
                        p.ChromeHover
                    }
                },
                Focus: p.Ring(-2),
            },
        }.Build()
    }
}
