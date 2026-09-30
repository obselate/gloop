package gloop

import Goo
import System

class DialogShell {
    shared {
        internal func Build(
            stringTitle string,
            content Blob,
            actions Blob,
            handle ElementHandle,
            dismiss Action,
            keyDown Action[KeyEvent],
            keys[]KeyBinding,
            window Window,
            p Palette,
            width float64 = 420,
            compact bool = false
        ) Blob -> Container{
            Key: "dialog-overlay",
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Top: 0,
            Bottom: 0,
            BackgroundColor: Color.Rgba(0, 0, 0, 140),
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Container{
                Key: "dialog",
                Handle: handle,
                Focusable: true,
                Width: width,
                MaxWidth: Percent(92),
                OnKeyDown: keyDown,
                KeyBindings: keys,
                MaxHeight: Percent(88),
                Padding: if compact {
                    12
                } else {
                    18
                },
                Gap: if compact {
                    8
                } else {
                    14
                },
                BackgroundColor: p.Surface,
                BorderWidth: 1,
                BorderColor: p.Border,
                BorderRadius: 8,
                Accessibility: Accessibility{Role: AccessibilityRole.Dialog, Name: stringTitle},
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Ui.Label(stringTitle, p.Text, 16, 600),
                    Container{FlexGrow: 1},
                    Ui.Tool("close", "Close dialog", dismiss, window, p),
                },
                content,
                actions,
            },
        }
    }
}
