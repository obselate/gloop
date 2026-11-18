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
            CloseHoverBackgroundColor: p.Danger,
            EnableDoubleClick: true,
            ConfigureControl: (_, command, icon, _, button) -> {
                let name = command.ToString()
                button.BackgroundColor = Color.Transparent
                button.FocusStyle = p.Ring(-2)
                button.Children.Clear()
                button.Children.Add(
                    Ui.HoverLabel(
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
                )
            },
        }.Build()
    }
}
