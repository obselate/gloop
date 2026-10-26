package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func Rounded() bool -> palette.Glass && window?.State != WindowState.Maximized
    && window?.State != WindowState.Fullscreen

    private func ApplyBackdrop() {
        guard let host = window else {
            return
        }

        Theme.Attach(host, palette.WidgetTheme)
        UpdateBackdropRegion()
    }

    private func UpdateBackdropRegion() {
        guard let host = window else {
            return
        }

        host.WaylandBackdrop = Rounded() ? WaylandBackdropOptions{
            Region: ElementRect{X: 1, Y: 1, Width: Math.Max(0, host.Width - 2), Height: Math.Max(0, host.Height - 2)},
            CornerRadius: Ui.WindowRadius - 1,
        }: WaylandBackdropOptions{}
    }

    private func KeyPressed(key Key, modifiers KeyModifiers) {
        let modifier = key is Key.ShiftLeft or Key.ShiftRight or Key.ControlLeft or Key.ControlRight or Key.AltLeft
        or Key.AltRight or Key.SuperLeft or Key.SuperRight

        if !modifier && !modifiers.Ctrl && !modifiers.Alt && !modifiers.Super {
            SetKeyboardFocus(true)
        }
    }

    private func SetKeyboardFocus(value bool) {
        if keyboardFocus != value {
            keyboardFocus = value
            palette = Palette(settings.Theme, value)

            Rebuild()
        }
    }

    private func WindowResized(metrics WindowMetrics) {
        UpdateBackdropRegion()
    }

    private func WindowStateChanged(state WindowState) {
        UpdateBackdropRegion()
        Rebuild()
    }
}
