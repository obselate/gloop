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
            if name == "Glass" {
                return Make(
                    "#090B10",
                    "#161A22",
                    "#ECEDED",
                    "#B8BFC9",
                    "#478AD1",
                    "#2A303B",
                    "#17273A",
                    "#C3A6FF",
                    "#8FD694",
                    "#F0A56B",
                    "#E8CF8A"
                )
            }
            if name == "Catppuccin Mocha" {
                return Make(
                    "#1E1E2E",
                    "#313244",
                    "#CDD6F4",
                    "#A6ADC8",
                    "#89B4FA",
                    "#45475A",
                    "#38425F",
                    "#CBA6F7",
                    "#A6E3A1",
                    "#FAB387",
                    "#F9E2AF"
                )
            }
            if name == "Tokyo Night" {
                return Make(
                    "#1A1B26",
                    "#24283B",
                    "#C0CAF5",
                    "#A9B1D6",
                    "#7AA2F7",
                    "#414868",
                    "#313B58",
                    "#BB9AF7",
                    "#9ECE6A",
                    "#FF9E64",
                    "#E0AF68"
                )
            }
            if name == "Nord" {
                return Make(
                    "#2E3440",
                    "#3B4252",
                    "#D8DEE9",
                    "#BFC8D7",
                    "#88C0D0",
                    "#4C566A",
                    "#445663",
                    "#81A1C1",
                    "#A3BE8C",
                    "#B48EAD",
                    "#EBCB8B"
                )
            }
            if name == "Gruvbox Dark" {
                return Make(
                    "#282828",
                    "#3C3836",
                    "#EBDBB2",
                    "#BDAE93",
                    "#FABD2F",
                    "#504945",
                    "#4A4029",
                    "#FB4934",
                    "#B8BB26",
                    "#D3869B",
                    "#FABD2F"
                )
            }
            if name == "Catppuccin Latte" {
                return Make(
                    "#EFF1F5",
                    "#E6E9EF",
                    "#4C4F69",
                    "#5C5F77",
                    "#1E66F5",
                    "#BCC0CC",
                    "#B4CAF5",
                    "#8839EF",
                    "#276A22",
                    "#9C4221",
                    "#7C4B00"
                )
            }
            if name == "Rose Pine" {
                return Make(
                    "#191724",
                    "#26233A",
                    "#E0DEF4",
                    "#908CAA",
                    "#C4A7E7",
                    "#403D52",
                    "#423A53",
                    "#C4A7E7",
                    "#9CCFD8",
                    "#EB6F92",
                    "#F6C177"
                )
            }
            if name == "Rose Pine Dawn" {
                return Make(
                    "#FAF4ED",
                    "#F2E9E1",
                    "#575279",
                    "#6E6A86",
                    "#7A6593",
                    "#DFDAD9",
                    "#C7BBC9",
                    "#765D8C",
                    "#286983",
                    "#9B4059",
                    "#8A5B14"
                )
            }
            if name == "Dracula" {
                return Make(
                    "#282A36",
                    "#21222C",
                    "#F8F8F2",
                    "#BFBFC6",
                    "#BD93F9",
                    "#44475A",
                    "#4C4365",
                    "#FF79C6",
                    "#50FA7B",
                    "#BD93F9",
                    "#8BE9FD"
                )
            }
            if name == "Kanagawa Wave" {
                return Make(
                    "#1F1F28",
                    "#2A2A37",
                    "#DCD7BA",
                    "#A6A69C",
                    "#7E9CD8",
                    "#54546D",
                    "#363D52",
                    "#957FB8",
                    "#98BB6C",
                    "#E6C384",
                    "#7FB4CA"
                )
            }
            if name == "Everforest Dark Hard" {
                return Make(
                    "#1E2326",
                    "#272E33",
                    "#D3C6AA",
                    "#9DA9A0",
                    "#A7C080",
                    "#3C4841",
                    "#3C463A",
                    "#D699B6",
                    "#A7C080",
                    "#E69875",
                    "#7FBBB3"
                )
            }
            if name == "Ayu Mirage" {
                return Make(
                    "#1F2430",
                    "#171B24",
                    "#CCCAC2",
                    "#A6A5A0",
                    "#73D0FF",
                    "#343B4A",
                    "#314A5E",
                    "#DABAFA",
                    "#87D96C",
                    "#FACC6E",
                    "#6DCBFA"
                )
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
            selection string,
            keyword string,
            syntaxString string,
            number string,
            syntaxType string
        ) ThemePalette {
            let theme = ThemePalette()
            theme.Background = background
            theme.Surface = surface
            theme.Text = text
            theme.MutedText = mutedText
            theme.Accent = accent
            theme.Border = border
            theme.Selection = selection
            theme.Keyword = keyword
            theme.String = syntaxString
            theme.Number = number
            theme.Type = syntaxType
            return theme
        }
    }
}
