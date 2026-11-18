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
            CreateControlContent: (icon, command) -> {
                let name = command.ToString()
                return Ui.HoverLabel(
                    name,
                    name,
                    Container{
                        Width: ControlWidth,
                        Height: Ui.BarHeight,
                        HitTestSelf: true,
                        AlignItems: AlignItems.Center,
                        JustifyContent: JustifyContent.Center,
                        icon,
                    },
                    window,
                    p
                )
            },
            ConfigureControl: (_, command, _, _, button) -> {
                button.Width = ControlWidth
                button.Height = Ui.BarHeight
                button.Padding = 0
                button.BackgroundColor = Color.Transparent
                button.HoverStyle = Style{
                    BackgroundColor: if command == WindowChromeAction.Close {
                        p.Danger
                    } else {
                        p.ChromeHover
                    }
                }
                button.FocusStyle = p.Ring(-2)
            },
        }.Build()
    }
}
