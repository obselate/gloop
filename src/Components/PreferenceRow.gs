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
                    ThumbBorderWidth = 3,
                    ThumbBorderColor = p.Text,
                    ThumbStyle = Style{BoxShadow: BoxShadow{OffsetY: 1, Blur: 4, Color: p.Shadow.WithAlpha(.4)}},
                    TrackThickness = 5,
                    ThumbSize = 20,
                    BackgroundColor = Color.Transparent,
                    ConfigureRoot = (_, root) -> {
                        root.BorderRadius = p.WidgetTheme.ControlRadius ?? 6.0
                        root.FocusStyle = Style{OutlineColor: p.Accent, OutlineWidth: 1, OutlineOffset: -1}
                    },
                }
            ),
            p,
            row,
            true
        ){.Padding: Edges{Left: 4, Right: 4, Top: 4, Bottom: 4}}
    }
}
