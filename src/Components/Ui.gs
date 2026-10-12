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

class Palette {
    internal let Background Color
    internal let Surface Color
    internal let Text Color
    internal let Muted Color
    internal let Accent Color
    internal let Border Color
    internal let Selection Color
    internal let Error Color
    internal let Keyword Color
    internal let String Color
    internal let Number Color
    internal let Type Color
    internal let Glass bool
    internal let Window Color
    internal let Canvas Color
    internal let Sidebar Color
    internal let Preview Color
    internal let Hover Color
    internal let Bar Color
    internal let Overlay Color
    internal let Edge Color
    internal let Blur float64
    internal let Keyboard bool

    internal init(theme ThemePalette, keyboard bool = false) {
        Keyboard = keyboard
        let preset = ThemePresets.Match(theme)
        Glass = preset == "Glass"
        Background = Color.Parse(theme.Background)
        Surface = Color.Parse(theme.Surface)
        Text = Color.Parse(theme.Text)
        Muted = Color.Parse(theme.MutedText)
        Accent = Color.Parse(theme.Accent)
        Border = Color.Parse(theme.Border)
        Selection = Glass ? Accent.WithAlpha(.38): Color.Parse(theme.Selection)
        Window = Glass ? Background.WithAlpha(.78): Background
        Canvas = Glass ? Color.Transparent: Background
        Sidebar = Glass ? Color.White.WithAlpha(.015): Surface
        Preview = Glass ? Color.Rgba(0, 0, 0, 46): Surface
        Hover = Glass ? Color.White.WithAlpha(.012): Surface
        Bar = Glass ? Color.Transparent: Surface
        Overlay = Glass ? Surface.WithAlpha(.52): Surface
        Edge = Glass ? Color.Rgba(184, 191, 201, 56): Border
        Blur = Glass ? 24: 0
        Error = ColorMath.GooColor(ColorMath.Foreground(ColorMath.ParseHex(theme.Surface) ?? 0, 0x9F3545, 0xF0AF9D))
        let syntax = switch preset {
            case "": []string{theme.Accent, theme.Text, theme.MutedText, theme.Accent}
            case "Glass": []string{"#C3A6FF", "#8FD694", "#F0A56B", "#E8CF8A"}
            case "Tokyo Night": []string{"#BB9AF7", "#9ECE6A", "#FF9E64", "#E0AF68"}
            case "Nord": []string{"#81A1C1", "#A3BE8C", "#B48EAD", "#EBCB8B"}
            case "Gruvbox Dark": []string{"#FB4934", "#B8BB26", "#D3869B", "#FABD2F"}
            case "Catppuccin Latte": []string{"#8839EF", "#276A22", "#9C4221", "#7C4B00"}
            case "Rose Pine": []string{"#C4A7E7", "#9CCFD8", "#EB6F92", "#F6C177"}
            case "Rose Pine Dawn": []string{"#765D8C", "#286983", "#9B4059", "#8A5B14"}
            case "Dracula": []string{"#FF79C6", "#50FA7B", "#BD93F9", "#8BE9FD"}
            case "Kanagawa Wave": []string{"#957FB8", "#98BB6C", "#E6C384", "#7FB4CA"}
            case "Everforest Dark Hard": []string{"#D699B6", "#A7C080", "#E69875", "#7FBBB3"}
            case "Ayu Mirage": []string{"#DABAFA", "#87D96C", "#FACC6E", "#6DCBFA"}
            default: []string{"#CBA6F7", "#A6E3A1", "#FAB387", "#F9E2AF"}
        }
        Keyword = Color.Parse(syntax[0])
        String = Color.Parse(syntax[1])
        Number = Color.Parse(syntax[2])
        Type = Color.Parse(syntax[3])
    }

    internal func Ring(offset float64 = 0, width float64 = 1) Style -> if Keyboard {
        Style{OutlineWidth: width, OutlineColor: Accent, OutlineOffset: offset}
    } else {
        Style{}
    }

    internal func FocusBorder() Style -> if Keyboard {
        Style{BorderColor: Accent}
    } else {
        Style{}
    }

    internal func IconColor(icon string) Color -> switch icon {
        case "folder": Accent
        case "image": Type
        case "code": Keyword
        case "folder_zip": Number
        case "audio_file" or "video_file": String
        default: Muted
    }
}

class Ui {
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

        internal func Shadow() BoxShadow -> BoxShadow{OffsetY: 12, Blur: 32, Color: Color.Black.WithAlpha(.6)}

        internal func BubbleStyle(p Palette) Style -> Style{
            BackgroundColor: p.Overlay,
            BackdropBlur: p.Blur,
            BorderColor: p.Edge,
            BorderWidth: 1,
            Color: p.Text,
            FontSize: 11,
            Padding: Edges{Left: 9, Right: 9, Top: 6, Bottom: 6},
            BorderRadius: 6,
            BoxShadow: BoxShadow{OffsetY: 4, Blur: 12, Color: Color.Black.WithAlpha(.5)},
        }

        internal func Label(
            value string,
            color Color,
            size float64 = 13,
            weight float64 = 400,
            align TextAlign = TextAlign.Start
        ) Text -> Text{
            Content: value,
            Color: color,
            FontSize: size,
            FontWeight: weight,
            TextAlign: align,
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
            size float64 = 30,
            iconSize float64 = 20,
            hoverColor Color? = nil
        ) Container -> Container{
            Width: size,
            Height: size,
            FlexShrink: 0,
            Cell.Mount[TooltipInput, Tooltip](
                label,
                TooltipInput{
                    Window: window,
                    Content: Label(label, p.Text, 11),
                    Placement: PortalPlacement.Bottom,
                    BubbleStyle: BubbleStyle(p),
                    Target: IconButton{
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
                        Width: size,
                        Height: size,
                        BorderRadius: 6,
                        BackgroundColor: Color.Transparent,
                        ActiveBackgroundColor: p.Selection,
                        HoverBackgroundColor: hoverColor ?? p.Border,
                        ShowFocusHighlight: p.Keyboard,
                        FocusOutlineColor: p.Accent,
                    }.Build(),
                }
            ),
        }

        internal func ActionButton(
            label string,
            action Action,
            p Palette,
            primary bool = false,
            handle ElementHandle? = nil
        ) Blob {
            let button = Button{
                Handle: handle,
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
                Label(
                    label,
                    if primary {
                        p.Background
                    } else {
                        p.Text
                    },
                    13,
                    600
                ),
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
