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
    internal let Fluent bool
    internal let Density RowDensity
    internal let AlternatingRows bool
    internal let RowHeight float64
    internal let HeaderHeight float64
    internal let FontSize float64
    internal let SecondaryFontSize float64
    internal let RowIconSize float64
    internal let ControlRadius float64
    internal let CardRadius float64
    internal let Window Color
    internal let Canvas Color
    internal let Sidebar Color
    internal let Preview Color
    internal let Hover Color
    internal let ChromeHover Color
    internal let ChromeSelection Color
    internal let Bar Color
    internal let Overlay Color
    internal let SubtleSurface Color
    internal let RaisedSurface Color
    internal let RowStripe Color
    internal let OnAccent Color
    internal let Blur float64
    internal let Keyboard bool
    internal let WidgetTheme Theme
    internal let Danger Color = Color.Parse("#9F3545")
    internal let Scrim Color
    internal let Shadow Color = Color.Black
    internal let GlassGradient LinearGradient = LinearGradient(Color.Parse("#2B6FD6"), Color.Parse("#D43C8C"))

    internal func PopupStyle() Style -> Style{
        BoxShadow: Ui.Shadow(this),
        BasedOn: WidgetTheme.OverlayStyle,
        BackgroundColor: Overlay,
        BorderWidth: 1,
        BorderColor: Border,
        BorderRadius: CardRadius,
    }

    internal init(
        theme ThemePalette,
        keyboard bool = false,
        density RowDensity = RowDensity.Comfortable,
        alternatingRows bool = false
    ) {
        Keyboard = keyboard
        Glass = theme.Glass
        Fluent = theme.Fluent
        Density = density
        AlternatingRows = alternatingRows
        RowHeight = switch density {
            case RowDensity.Compact: 26.0
            case RowDensity.Spacious: 38.0
            default: 32.0
        }
        HeaderHeight = switch density {
            case RowDensity.Compact: 26.0
            case RowDensity.Spacious: 32.0
            default: 28.0
        }
        FontSize = switch density {
            case RowDensity.Compact: 12.0
            case RowDensity.Spacious: 14.0
            default: 13.0
        }
        SecondaryFontSize = density == RowDensity.Compact ? 11.0: 12.0
        RowIconSize = switch density {
            case RowDensity.Compact: 16.0
            case RowDensity.Spacious: 20.0
            default: 18.0
        }
        ControlRadius = Fluent ? 4.0: 6.0
        CardRadius = Fluent ? 8.0: 10.0

        Background = Color.Parse(theme.Background)
        Surface = Color.Parse(theme.Surface)
        Text = Color.Parse(theme.Text)
        Muted = Color.Parse(theme.MutedText)
        Accent = Color.Parse(theme.Accent)
        Border = Color.Parse(theme.Border)

        let dark = Background.R + Background.G + Background.B < Text.R + Text.G + Text.B
        Scrim = Color.Black.WithAlpha(dark ? .55: .2)
        OnAccent = ColorMath.GooColor(ColorMath.Foreground(ColorMath.ParseHex(theme.Accent) ?? 0, 0x111111, 0xFFFFFF))
        let baseTheme = Fluent ? Theme.Fluent: (dark ? Theme.Ink: Theme.Bone)
        let colors = baseTheme with{
            CanvasColor = Background,
            PanelColor = Background,
            OverlayColor = Surface,
            TextColor = Text,
            MutedTextColor = Muted,
            AccentColor = Accent,
            BorderColor = Border,
            FontFamily = "",
            HeadingFontFamily = "",
            ControlRadius = ControlRadius,
            PanelRadius = Fluent ? 8.0: Ui.WindowRadius,
            Controls = Fluent ? ControlStyle.Fluent: ControlStyle.Standard,
            Selection = Fluent ? SelectionStyle.Indicator: baseTheme.Selection,
            TransitionMs = Fluent ? 83.0: baseTheme.TransitionMs,
        }
        if Glass {
            let glassTheme = colors.WithGlass()
            let alpha = if let percent = theme.GlassOpacity {
                percent / 100.0
            } else {
                float64((glassTheme.GlassColor ?? Background).A)
            }
            WidgetTheme = glassTheme with{
                GlassColor = Background.WithAlpha(alpha),
                OverlayColor = Surface.WithAlpha(alpha),
                OverlayBlur = alpha < 1 ? (Fluent ? 30.0: glassTheme.OverlayBlur): 0,
            }
        } else {
            WidgetTheme = colors
        }

        Selection = Glass ? Accent.WithAlpha(dark ? .32: .2): Color.Parse(theme.Selection)
        Window = WidgetTheme.GlassColor ?? Background
        Canvas = Background
        Sidebar = Glass ? Color.Transparent: Surface
        Preview = Surface
        Hover = Glass ? Text.WithAlpha(.06): Surface
        ChromeHover = Glass ? Text.WithAlpha(.08): Border
        ChromeSelection = Glass ? Text.WithAlpha(.12): Selection
        Bar = Glass ? Color.Transparent: Surface
        Overlay = WidgetTheme.OverlayColor
        SubtleSurface = Glass ? Text.WithAlpha(dark ? .05: .04): Surface
        RaisedSurface = Glass ? Surface.WithAlpha(dark ? .72: .88): Surface
        RowStripe = Text.WithAlpha(.025)
        Blur = Glass ? WidgetTheme.OverlayBlur: 0
        Error = ColorMath.GooColor(ColorMath.Foreground(ColorMath.ParseHex(theme.Surface) ?? 0, 0x9F3545, 0xF0AF9D))

        let preset = theme.Keyword == "" ? ThemePresets.Match(theme): ""
        let syntax = preset != "" ? ThemePresets.Create(preset): theme
        Keyword = Color.Parse(syntax.Keyword == "" ? theme.Accent: syntax.Keyword)
        String = Color.Parse(syntax.String == "" ? theme.Text: syntax.String)
        Number = Color.Parse(syntax.Number == "" ? theme.MutedText: syntax.Number)
        Type = Color.Parse(syntax.Type == "" ? theme.Accent: syntax.Type)
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
