package gloop

import Goo
import Goo.Widgets.Inputs
import System

class PreferenceRow {
    shared {
        internal func Build(
            label string,
            control Blob,
            p Palette,
            row ElementHandle? = nil,
            stacked bool = false
        ) Container {
            let root = Container{
                Handle: row,
                OnFocus: (_) -> row?.ScrollIntoView(),
                MinHeight: stacked ? 0: 38,
                FlexShrink: 0,
                FlexDirection: stacked ? FlexDirection.Column: FlexDirection.Row,
                AlignItems: stacked ? AlignItems.Stretch: AlignItems.Center,
                Gap: stacked ? 0: 18,
            }

            if label != "" {
                root.Children.Add(
                    Container{
                        FlexGrow: 1,
                        FlexBasis: 0,
                        MinWidth: 0,
                        Text{Content: label, Color: p.Text, FontSize: 13, TextWrap: TextWrap.Wrap},
                    }
                )
            }

            root.Children.Add(control)

            return root
        }

        internal func Toggle(label string, value bool, toggle Action, row ElementHandle, p Palette) Blob -> Build(
            label,
            ToggleSwitch{
                Checked: value,
                AccessibilityName: label,
                OnClick: toggle,
                OffTrackColor: p.Border,
                OnTrackColor: p.Accent,
                ThumbColor: p.Text,
                OnThumbColor: p.Background,
                BorderColor: p.Border,
                ShowFocusHighlight: p.Keyboard,
                FocusBorderColor: p.Text,
            }.Build(),
            p,
            row
        )
    }
}
