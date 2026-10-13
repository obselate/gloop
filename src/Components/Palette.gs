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
