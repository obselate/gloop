package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Actions
import Goo.Widgets.Colors
import Goo.Widgets.Icons
import Goo.Widgets.Layout
import System

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

    internal init(theme ThemePalette) {
        Background = Color.Parse(theme.Background)
        Surface = Color.Parse(theme.Surface)
        Text = Color.Parse(theme.Text)
        Muted = Color.Parse(theme.MutedText)
        Accent = Color.Parse(theme.Accent)
        Border = Color.Parse(theme.Border)
        Selection = Color.Parse(theme.Selection)
        Error = ColorMath.GooColor(ColorMath.Foreground(ColorMath.ParseHex(theme.Surface) ?? 0, 0x9F3545, 0xF0AF9D))
        let preset = ThemePresets.Match(theme)
        let syntax = switch preset {
            case "": []string{theme.Accent, theme.Text, theme.MutedText, theme.Accent}
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
}

class Ui {
    shared {
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
            disabled bool = false
        ) Blob -> Container{
            Width: 30,
            Height: 30,
            FlexShrink: 0,
            Cell.Mount[TooltipInput, Tooltip](
                label,
                TooltipInput{
                    Window: window,
                    Content: Label(label, p.Text, 11),
                    Placement: PortalPlacement.Bottom,
                    BubbleStyle: Style{
                        BackgroundColor: p.Surface,
                        BorderColor: p.Border,
                        BorderWidth: 1,
                        Color: p.Text,
                        FontSize: 11,
                        Padding: Edges{Left: 9, Right: 9, Top: 6, Bottom: 6},
                        BorderRadius: 5,
                    },
                    Target: IconButton{
                        Icon: Icon(
                            name,
                            if active {
                                p.Accent
                            } else {
                                p.Muted
                            }
                        ),
                        AccessibilityName: label,
                        OnClick: action,
                        Active: active,
                        Disabled: disabled,
                        Width: 30,
                        Height: 30,
                        BorderRadius: 6,
                        BackgroundColor: Color.Transparent,
                        ActiveBackgroundColor: p.Selection,
                        HoverBackgroundColor: p.Border,
                        ShowFocusHighlight: true,
                        FocusOutlineColor: p.Accent,
                    }.Build(),
                }
            ),
        }

        internal func ActionButton(label string, action Action, p Palette, primary bool = false) Blob {
            let button = Button{
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
                Focus: Style{OutlineWidth: 2, OutlineColor: p.Accent, OutlineOffset: 2},
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
            Track: Container{BackgroundColor: p.Surface},
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
