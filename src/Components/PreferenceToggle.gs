package gloop

import Goo
import Goo.Widgets.Inputs
import System

class PreferenceToggle {
    shared {
        internal func Build(label string, value bool, toggle Action, row ElementHandle, p Palette) Blob -> Container{
            Handle: row,
            OnFocus: (_) -> row.ScrollIntoView(),
            Height: 38,
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Container{FlexGrow: 1, Ui.Label(label, p.Text)},
            ToggleSwitch{
                Checked: value,
                AccessibilityName: label,
                OnClick: toggle,
                OffTrackColor: p.Border,
                OnTrackColor: p.Accent,
                ThumbColor: p.Text,
                OnThumbColor: p.Background,
                BorderColor: p.Border,
                ShowFocusHighlight: true,
                FocusBorderColor: p.Text,
            }.Build(),
        }
    }
}
