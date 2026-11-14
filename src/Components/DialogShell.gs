package gloop

import Goo
import System

class DialogShell {
    shared {
        internal func ScrollColumn(
            children[]Blob,
            p Palette,
            gap float64 = 8,
            height Length = default(Length),
            shrink float64 = 1
        ) Container -> Container{
            Height: height,
            MinHeight: 0,
            FlexShrink: shrink,
            OverflowY: Overflow.Scroll,
            ScrollbarY: Ui.ScrollbarStyle(p),
            ScrollbarVisibilityY: ScrollbarVisibility.Always,
            Padding: Edges{Right: 12},
            Gap: gap,
            Children: children,
        }

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
            compact bool = false,
            dismissDisabled bool = false,
            maxHeight float64 = 88
        ) Blob -> Container{
            Key: "dialog-overlay",
            Position: PositionType.Absolute,
            Left: 0,
            Right: 0,
            Top: 0,
            Bottom: 0,
            BackgroundColor: p.Scrim,
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
                MaxHeight: Percent(maxHeight),
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
                BasedOn: p.PopupStyle(),
                Accessibility: Accessibility{Role: AccessibilityRole.Dialog, Name: stringTitle},
                Container{
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Ui.Label(stringTitle, p.Text, 16, 600),
                    Container{FlexGrow: 1},
                    Ui.Tool("close", "Close dialog", dismiss, window, p, disabled: dismissDisabled),
                },
                content,
                actions,
            },
        }
    }
}
