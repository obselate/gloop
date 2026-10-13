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
    internal let Danger Color = Color.Parse("#9F3545")
    internal let Scrim Color = Color.Rgba(0, 0, 0, 140)
    internal let Shadow Color = Color.Black
    internal let GlassGradient LinearGradient = LinearGradient(Color.Parse("#2B6FD6"), Color.Parse("#D43C8C"))

    internal func PopupStyle() Style -> Style{
        BackgroundColor: Overlay,
        BackdropBlur: Blur,
        BorderWidth: 1,
        BorderColor: Edge,
        BorderRadius: 10,
        BoxShadow: Ui.Shadow(this),
    }

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

        let syntax = preset == "" ? nil: ThemePresets.Create(preset)
        Keyword = Color.Parse(syntax?.Keyword ?? theme.Accent)
        String = Color.Parse(syntax?.String ?? theme.Text)
        Number = Color.Parse(syntax?.Number ?? theme.MutedText)
        Type = Color.Parse(syntax?.Type ?? theme.Accent)
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
