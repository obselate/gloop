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
                Value: value,
                AccessibilityName: label,
                OnChange: (_) -> toggle(),
                OffTrackColor: p.Border,
                OnTrackColor: p.Accent,
                ThumbColor: p.Text,
                OnThumbColor: p.Background,
                BorderColor: p.Border,
                FocusBorderColor: p.Text,
            }.Build(),
            p,
            row
        )

        internal func Slider(key string, input SliderInput, row ElementHandle, p Palette) Blob -> Build(
            "",
            Cell.Mount[SliderInput, Goo.Widgets.Inputs.Slider](
                key,
                input with{
                    ShowValue = true,
                    LabelColor = p.Text,
                    ValueColor = p.Muted,
                    TrackColor = p.Border,
                    FillColor = p.Accent,
                    ThumbColor = p.Accent,
                    ThumbBorderColor = p.Surface,
                    TrackThickness = 4,
                    ThumbSize = 14,
                    BackgroundColor = Color.Transparent,
                    ConfigureRoot = (_, root) -> {
                        root.BorderRadius = p.WidgetTheme.ControlRadius
                        root.FocusStyle = p.Ring()
                    },
                }
            ),
            p,
            row,
            true
        ){.Padding: Edges{Left: 10, Right: 10, Top: 10, Bottom: 6}}
    }
}
