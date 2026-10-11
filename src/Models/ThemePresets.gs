package gloop

internal class ThemePresets {
    shared {
        internal func Names()[]string -> []string{
            "Glass",
            "Catppuccin Mocha",
            "Tokyo Night",
            "Nord",
            "Gruvbox Dark",
            "Catppuccin Latte",
            "Rose Pine",
            "Rose Pine Dawn",
            "Dracula",
            "Kanagawa Wave",
            "Everforest Dark Hard",
            "Ayu Mirage",
        }

        internal func Roles()[]string -> []string{
            "Background",
            "Surface",
            "Text",
            "Muted text",
            "Accent",
            "Border",
            "Selection",
        }

        internal func Create(name string) ThemePalette {
            if name == "Catppuccin Mocha" {
                return Make("#1E1E2E", "#313244", "#CDD6F4", "#A6ADC8", "#89B4FA", "#45475A", "#38425F")
            }
            if name == "Tokyo Night" {
                return Make("#1A1B26", "#24283B", "#C0CAF5", "#A9B1D6", "#7AA2F7", "#414868", "#313B58")
            }
            if name == "Nord" {
                return Make("#2E3440", "#3B4252", "#D8DEE9", "#BFC8D7", "#88C0D0", "#4C566A", "#445663")
            }
            if name == "Gruvbox Dark" {
                return Make("#282828", "#3C3836", "#EBDBB2", "#BDAE93", "#FABD2F", "#504945", "#4A4029")
            }
            if name == "Catppuccin Latte" {
                return Make("#EFF1F5", "#E6E9EF", "#4C4F69", "#5C5F77", "#1E66F5", "#BCC0CC", "#B4CAF5")
            }
            if name == "Rose Pine" {
                return Make("#191724", "#26233A", "#E0DEF4", "#908CAA", "#C4A7E7", "#403D52", "#423A53")
            }
            if name == "Rose Pine Dawn" {
                return Make("#FAF4ED", "#F2E9E1", "#575279", "#6E6A86", "#7A6593", "#DFDAD9", "#C7BBC9")
            }
            if name == "Dracula" {
                return Make("#282A36", "#21222C", "#F8F8F2", "#BFBFC6", "#BD93F9", "#44475A", "#4C4365")
            }
            if name == "Kanagawa Wave" {
                return Make("#1F1F28", "#2A2A37", "#DCD7BA", "#A6A69C", "#7E9CD8", "#54546D", "#363D52")
            }
            if name == "Everforest Dark Hard" {
                return Make("#1E2326", "#272E33", "#D3C6AA", "#9DA9A0", "#A7C080", "#3C4841", "#3C463A")
            }
            if name == "Ayu Mirage" {
                return Make("#1F2430", "#171B24", "#CCCAC2", "#A6A5A0", "#73D0FF", "#343B4A", "#314A5E")
            }
            return ThemePalette()
        }

        internal func Contains(name string) bool {
            for preset in Names() {
                if preset == name {
                    return true
                }
            }
            return false
        }

        internal func Match(theme ThemePalette) string {
            for name in Names() {
                let preset = Create(name)
                if theme.Background == preset.Background && theme.Surface == preset.Surface
                && theme.Text == preset.Text && theme.MutedText == preset.MutedText
                && theme.Accent == preset.Accent && theme.Border == preset.Border
                && theme.Selection == preset.Selection {
                    return name
                }
            }
            return ""
        }

        private func Make(
            background string,
            surface string,
            text string,
            mutedText string,
            accent string,
            border string,
            selection string
        ) ThemePalette {
            let theme = ThemePalette()
            theme.Background = background
            theme.Surface = surface
            theme.Text = text
            theme.MutedText = mutedText
            theme.Accent = accent
            theme.Border = border
            theme.Selection = selection
            return theme
        }
    }
}
