package gloop

import Goo
import System

class TextField {
    shared {
        internal const Height float64 = 32

        internal func FieldStyle(p Palette, invalid bool = false) Style -> Style{
            Height: Height,
            Padding: Edges{Left: 8, Right: 8},
            BackgroundColor: p.Surface,
            Color: p.Text,
            FontSize: 13,
            BorderWidth: 1,
            BorderColor: invalid ? p.Error: p.Border,
            BorderRadius: 6,
        }

        internal func Build(
            value string,
            change Action[string],
            submit Action[string],
            name string,
            p Palette,
            invalid bool = false,
            width Length = default(Length),
            handle ElementHandle? = nil,
            autoFocus bool = false,
            fontSize float64 = 13,
            padding float64 = 8
        ) TextEntry -> TextEntry{
            Focus: Style{BorderColor: invalid ? p.Error: p.Accent},
            BasedOn: FieldStyle(p, invalid),
            FontSize: fontSize,
            Padding: Edges{Left: padding, Right: padding},
            Handle: handle,
            Value: value,
            Controlled: true,
            AutoFocus: autoFocus,
            Width: width,
            MinWidth: 0,
            OnChange: change,
            OnSubmit: submit,
            Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: name, Invalid: invalid},
        }
    }
}
