package gloop

import Goo
import Goo.Svg
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Colors
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import System
import System.IO
import System.Text

class Ui {
    internal const ToolSize float64 = 30
    internal const ToolsGap float64 = 4
    internal const BarHeight float64 = 40

    shared {
        private let folder VectorAsset = Svg.Load(
            MemoryStream(
                Encoding.UTF8.GetBytes(
                    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path d=\"M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Z\"/></svg>"
                )
            )
        )

        internal func FileIcon(icon string, p Palette, size float64) Blob {
            if icon != "folder" {
                return Icon(icon, p.IconColor(icon), size)
            }
            let scale = size / float64(folder.ViewBoxWidth)
            return Shape{
                Path: folder.PathForNode(1),
                Width: size,
                Height: size,
                FlexShrink: 0,
                Fit: ShapeFit.Contain,
                Transform: PanelTransform{
                    TranslateX: -float64(folder.ViewBoxX) * scale,
                    TranslateY: -float64(folder.ViewBoxY) * scale,
                },
                BackgroundColor: p.Accent,
                Accessibility: Accessibility{Hidden: true},
            }
        }

        internal func Shadow(p Palette) BoxShadow -> BoxShadow{OffsetY: 12, Blur: 32, Color: p.Shadow.WithAlpha(.6)}

        internal func BubbleStyle(p Palette) Style -> Style{
            BackgroundColor: p.Overlay,
            BackdropBlur: p.Blur,
            BorderColor: p.Edge,
            BorderWidth: 1,
            Color: p.Text,
            FontSize: 11,
            Padding: Edges{Left: 9, Right: 9, Top: 6, Bottom: 6},
            BorderRadius: 6,
            BoxShadow: BoxShadow{OffsetY: 4, Blur: 12, Color: p.Shadow.WithAlpha(.5)},
        }

        internal func HoverLabel(
            key string,
            label string,
            target Blob,
            window Window,
            p Palette,
            placement PortalPlacement = PortalPlacement.Bottom,
            wrap bool = false
        ) Blob -> Cell
            .Mount[TooltipInput, Tooltip](
            key,
            TooltipInput{
                Window: window,
                Text: label,
                Content: Text{
                    Content: label,
                    Color: p.Text,
                    FontSize: 11,
                    MaxWidth: wrap ? 320: default(Length),
                    TextWrap: wrap ? TextWrap.Wrap: TextWrap.NoWrap,
                },
                Placement: placement,
                BubbleStyle: BubbleStyle(p),
                Target: target,
            }
        )

        internal func ErrorText(value string, p Palette) Text -> Text{
            Content: value,
            Color: p.Error,
            FontSize: 12,
            TextWrap: TextWrap.Wrap,
        }

        internal func Label(value string, color Color, size float64 = 13, weight float64 = 400) Text -> Text{
            Content: value,
            Color: color,
            FontSize: size,
            FontWeight: weight,
            TextWrap: TextWrap.NoWrap,
            TextTrimming: TextTrimming.Ellipsis,
            MinWidth: 0,
            FlexShrink: 1,
        }

        internal func Icon(name string, color Color, size float64 = 20) Blob {
            let icon = MaterialIcons.Create(name, size, color)
            icon.FlexShrink = 0
            return icon
        }

        internal func Tool(
            name string,
            label string,
            action Action,
            window Window,
            p Palette,
            active bool = false,
            disabled bool = false,
            size float64? = nil,
            iconSize float64 = 20,
            hoverColor Color? = nil
        ) Container -> Container{
            Width: size ?? ToolSize,
            Height: size ?? ToolSize,
            FlexShrink: 0,
            HoverLabel(
                label,
                label,
                IconButton{
                    Icon: Icon(
                        name,
                        if active {
                            p.Accent
                        } else {
                            p.Muted
                        },
                        iconSize
                    ),
                    AccessibilityName: label,
                    OnClick: action,
                    Active: active,
                    Disabled: disabled,
                    Width: size ?? ToolSize,
                    Height: size ?? ToolSize,
                    BorderRadius: 6,
                    BackgroundColor: Color.Transparent,
                    ActiveBackgroundColor: p.Selection,
                    HoverBackgroundColor: hoverColor ?? p.Border,
                    ShowFocusHighlight: p.Keyboard,
                    FocusOutlineColor: p.Accent,
                }.Build(),
                window,
                p
            ),
        }

        internal func ActionButton(
            label string,
            action Action,
            p Palette,
            primary bool = false,
            handle ElementHandle? = nil,
            maxWidth Length = default(Length)
        ) Blob {
            let button = Button{
                Handle: handle,
                MaxWidth: maxWidth,
                MinWidth: 0,
                Height: 34,
                Padding: Edges{Left: 14, Right: 14},
                BorderRadius: 6,
                AlignItems: AlignItems.Center,
                JustifyContent: JustifyContent.Center,
                BackgroundColor: if primary {
                    p.Accent
                } else {
                    p.Border
                },
                Hover: Style{Opacity: 0.82},
                Focus: p.Ring(2, 2),
                OnClick: action,
                Accessibility: Accessibility{Role: AccessibilityRole.Button, Name: label},
                Text{
                    Content: label,
                    Color: primary ? p.Background: p.Text,
                    FontSize: 13,
                    FontWeight: 600,
                    Width: maxWidth.HasMagnitude ? Percent(100): default(Length),
                    MaxWidth: maxWidth.HasMagnitude ? maxWidth.Magnitude - 28: default(Length),
                    MinWidth: 0,
                    FlexShrink: 1,
                    TextWrap: TextWrap.NoWrap,
                    TextTrimming: TextTrimming.Ellipsis,
                },
            }
            WidgetKeyBindings.BindActivation(button)
            return button
        }

        internal func Shortcut(key string, label string, p Palette) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 6,
            Container{
                Padding: Edges{Left: 5, Right: 5, Top: 2, Bottom: 2},
                BorderWidth: 1,
                BorderColor: p.Border,
                BorderRadius: 4,
                Label(key, p.Muted, 10),
            },
            Label(label, p.Muted, 11),
        }

        internal func ScrollbarStyle(p Palette, inset float64 = 2) Scrollbar -> Scrollbar{
            Thickness: 6,
            HitThickness: 12,
            Inset: inset,
            MinThumbLength: 28,
            ReserveSpace: true,
            Track: Container{BackgroundColor: p.Hover},
            Thumb: Container{BackgroundColor: p.Muted, BorderRadius: 3, Hover: Style{BackgroundColor: p.Accent},},
        }

        internal func Empty(icon string, title string, detail string, p Palette) Blob -> Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            OverflowY: Overflow.Scroll,
            ScrollbarY: ScrollbarStyle(p, 8),
            ScrollbarVisibilityY: ScrollbarVisibility.Always,
            Padding: 12,
            Container{
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.FlexStart,
                Gap: 10,
                Icon(icon, p.Muted, 22),
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    FlexShrink: 1,
                    Gap: 4,
                    Text{
                        Content: title,
                        Color: p.Text,
                        FontSize: 13,
                        FontWeight: 600,
                        FlexShrink: 0,
                        TextWrap: TextWrap.Wrap,
                    },
                    Text{Content: detail, Color: p.Muted, FontSize: 12, FlexShrink: 0, TextWrap: TextWrap.Wrap},
                },
            },
        }

        internal func Section(title string, p Palette) Blob -> Container{
            Padding: Edges{Left: 12, Top: 14, Bottom: 6},
            FlexShrink: 0,
            Text{Content: title, FontSize: 10, FontWeight: 600, LetterSpacing: 1.1, Color: p.Muted},
        }
    }
}
