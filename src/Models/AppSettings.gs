package gloop

import System
import System.Collections.Generic
import System.IO

internal class ThemePalette {
    internal var Background string
    internal var Surface string
    internal var Text string
    internal var MutedText string
    internal var Accent string
    internal var Border string
    internal var Selection string

    internal init() {
        Background = "#1E1E2E"
        Surface = "#313244"
        Text = "#CDD6F4"
        MutedText = "#A6ADC8"
        Accent = "#89B4FA"
        Border = "#45475A"
        Selection = "#585B70"
    }

    internal func Clone() ThemePalette {
        let copy = ThemePalette()
        copy.ApplyFrom(this)
        return copy
    }

    internal func ApplyFrom(source ThemePalette) {
        Background = source.Background
        Surface = source.Surface
        Text = source.Text
        MutedText = source.MutedText
        Accent = source.Accent
        Border = source.Border
        Selection = source.Selection
    }

    internal func ColorFor(role string) string -> switch role {
        case "Background": Background
        case "Surface": Surface
        case "Text": Text
        case "Muted text": MutedText
        case "Accent": Accent
        case "Border": Border
        case "Selection": Selection
        default: ""
    }

    internal func SetColor(role string, color string) {
        if role == "Background" {
            Background = color
        } else if role == "Surface" {
            Surface = color
        } else if role == "Text" {
            Text = color
        } else if role == "Muted text" {
            MutedText = color
        } else if role == "Accent" {
            Accent = color
        } else if role == "Border" {
            Border = color
        } else if role == "Selection" {
            Selection = color
        }
    }
}

internal class AppSettings {
    internal var ShowHidden bool
    internal var ShowPreview bool
    internal var PreviewWordWrap bool
    internal var PreviewLineNumbers bool
    internal var SplitView bool
    internal var ViewMode string
    internal var SmoothScrolling bool
    internal var ScrollSpeed float64
    internal let Keybindings Dictionary[string, string]
    internal let Bookmarks List[string]
    internal var Theme ThemePalette
    internal var ThemeName string
    internal var CustomTheme ThemePalette

    internal init() {
        ShowHidden = false
        ShowPreview = false
        PreviewWordWrap = true
        PreviewLineNumbers = true
        SplitView = false
        ViewMode = "list"
        SmoothScrolling = true
        ScrollSpeed = 1.5
        Theme = ThemePalette()
        ThemeName = "Catppuccin Mocha"
        CustomTheme = Theme.Clone()
        Keybindings = Dictionary[string, string](StringComparer.Ordinal)
        Bookmarks = List[string]()
        Keybindings["MoveUp"] = "Up"
        Keybindings["MoveDown"] = "Down"
        Keybindings["MoveLeft"] = "Left"
        Keybindings["MoveRight"] = "Right"
        Keybindings["MoveFirst"] = "Home"
        Keybindings["MoveLast"] = "End"
        Keybindings["PageUp"] = "PageUp"
        Keybindings["PageDown"] = "PageDown"
        Keybindings["Open"] = "Enter"
        Keybindings["SelectAll"] = "Ctrl+A"
        Keybindings["ToggleSelection"] = "Ctrl+Space"
        Keybindings["OpenTerminal"] = "F4"
        Keybindings["ViewList"] = "Ctrl+Number1"
        Keybindings["ViewTiles"] = "Ctrl+Number2"
        Keybindings["Parent"] = "Alt+Up"
        Keybindings["Back"] = "Alt+Left"
        Keybindings["Forward"] = "Alt+Right"
        Keybindings["FocusLocation"] = "Ctrl+L"
        Keybindings["FocusFilter"] = "Ctrl+F"
        Keybindings["TogglePreview"] = "Space"
        Keybindings["ToggleSplit"] = "Ctrl+S"
        Keybindings["NextPane"] = "Ctrl+Tab"
        Keybindings["FocusNext"] = "Tab"
        Keybindings["FocusPrevious"] = "Shift+Tab"
        Keybindings["ToggleHidden"] = "Ctrl+H"
        Keybindings["ToggleBookmark"] = "Ctrl+D"
        Keybindings["OpenBookmarks"] = "Ctrl+B"
        Keybindings["Refresh"] = "F5"
        Keybindings["NewFolder"] = "Ctrl+Shift+N"
        Keybindings["Rename"] = "F2"
        Keybindings["Copy"] = "Ctrl+C"
        Keybindings["Cut"] = "Ctrl+X"
        Keybindings["Paste"] = "Ctrl+V"
        Keybindings["Trash"] = "Delete"
        Keybindings["Dismiss"] = "Escape"
        Keybindings["Quit"] = "Ctrl+Q"
        Keybindings["OpenSettings"] = "Ctrl+Comma"
    }

    internal func ActionFor(key string, ctrl bool, alt bool, shift bool) string -> ActionFor(
        key,
        ctrl,
        alt,
        shift,
        false
    )

    internal func ActionFor(key string, ctrl bool, alt bool, shift bool, super bool) string {
        let name = Shortcut.KeyName(key)
        if name == "" {
            return ""
        }
        let shortcut = (ctrl ? "Ctrl+": "") + (alt ? "Alt+": "")
        + (shift ? "Shift+": "") + (super ? "Super+": "") + name
        for binding in Keybindings {
            if binding.Value == shortcut {
                return binding.Key
            }
        }
        return ""
    }

    internal func SetBinding(action string, shortcut string) string {
        let error = ValidateBinding(action, shortcut)
        if error != "" {
            return error
        }
        Keybindings[action] = Shortcut.Normalize(shortcut)
        return ""
    }

    internal func ValidateBinding(action string, shortcut string) string {
        if !Keybindings.ContainsKey(action) {
            return "Unknown action: " + action
        }
        let normalized = Shortcut.Normalize(shortcut)
        if normalized == "" {
            return "Invalid shortcut: " + shortcut
        }
        for binding in Keybindings {
            if binding.Key != action && binding.Value == normalized {
                return "Shortcut already assigned to " + binding.Key
            }
        }
        return ""
    }

    internal func IsBookmarked(path string) bool {
        let normalized = BookmarkPath.Normalize(path)
        return normalized != "" && Bookmarks.Contains(normalized)
    }

    internal func Clone() AppSettings {
        let copy = AppSettings()
        copy.ApplyFrom(this)
        return copy
    }

    internal func ApplyFrom(source AppSettings) {
        if Object.ReferenceEquals(this, source) {
            return
        }
        ShowHidden = source.ShowHidden
        ShowPreview = source.ShowPreview
        PreviewWordWrap = source.PreviewWordWrap
        PreviewLineNumbers = source.PreviewLineNumbers
        SplitView = source.SplitView
        ViewMode = source.ViewMode
        SmoothScrolling = source.SmoothScrolling
        ScrollSpeed = source.ScrollSpeed
        Theme.ApplyFrom(source.Theme)
        ThemeName = source.ThemeName
        CustomTheme.ApplyFrom(source.CustomTheme)
        Keybindings.Clear()
        for binding in source.Keybindings {
            Keybindings[binding.Key] = binding.Value
        }
        Bookmarks.Clear()
        for bookmark in source.Bookmarks {
            Bookmarks.Add(bookmark)
        }
    }
}

internal class BookmarkPath {
    shared {
        internal func Normalize(value string) string {
            if value == "" {
                return ""
            }
            try {
                if !Path.IsPathFullyQualified(value) {
                    return ""
                }
                return Path.TrimEndingDirectorySeparator(Path.GetFullPath(value))
            } catch (e Exception) {
                return ""
            }
        }
    }
}

internal class Shortcut {
    shared {
        internal func Normalize(value string) string {
            let parts = value.Split(char(43))
            if parts.Length == 0 {
                return ""
            }
            var ctrl = false
            var alt = false
            var shift = false
            var super = false
            for i in 0 ... parts.Length {
                let part = parts[i].Trim().ToUpperInvariant()
                if i == parts.Length - 1 {
                    let key = KeyName(part)
                    if key == "" {
                        return ""
                    }
                    return (ctrl ? "Ctrl+": "") + (alt ? "Alt+": "")
                    + (shift ? "Shift+": "") + (super ? "Super+": "") + key
                }
                if (part == "CTRL" || part == "CONTROL") && !ctrl {
                    ctrl = true
                } else if part == "ALT" && !alt {
                    alt = true
                } else if part == "SHIFT" && !shift {
                    shift = true
                } else if (part == "SUPER" || part == "META") && !super {
                    super = true
                } else {
                    return ""
                }
            }
            return ""
        }

        internal func KeyName(value string) string {
            let key = value.Trim().ToUpperInvariant()
            if key.Length == 1 {
                let letter = key[0]
                if letter >= char(65) && letter <= char(90) {
                    return key
                }
            }
            if key == "," || key == "COMMA" {
                return "Comma"
            }
            if key == "SPACE" {
                return "Space"
            }
            if key == "RETURN" || key == "ENTER" {
                return "Enter"
            }
            if key == "ESC" || key == "ESCAPE" {
                return "Escape"
            }
            if key == "DEL" || key == "DELETE" {
                return "Delete"
            }
            if key == "ARROWUP" || key == "UP" {
                return "Up"
            }
            if key == "ARROWDOWN" || key == "DOWN" {
                return "Down"
            }
            if key == "ARROWLEFT" || key == "LEFT" {
                return "Left"
            }
            if key == "ARROWRIGHT" || key == "RIGHT" {
                return "Right"
            }
            if key == "TAB" {
                return "Tab"
            }
            if key == "HOME" {
                return "Home"
            }
            if key == "END" {
                return "End"
            }
            if key == "PAGEUP" {
                return "PageUp"
            }
            if key == "PAGEDOWN" {
                return "PageDown"
            }
            if key == "BACKSPACE" {
                return "Backspace"
            }
            if key == "INSERT" {
                return "Insert"
            }
            if key == "'" || key == "APOSTROPHE" {
                return "Apostrophe"
            }
            if key == "-" || key == "MINUS" {
                return "Minus"
            }
            if key == "." || key == "PERIOD" {
                return "Period"
            }
            if key == "/" || key == "SLASH" {
                return "Slash"
            }
            if key == ";" || key == "SEMICOLON" {
                return "Semicolon"
            }
            if key == "=" || key == "EQUAL" {
                return "Equal"
            }
            if key == "[" || key == "LEFTBRACKET" {
                return "LeftBracket"
            }
            if key == "\\" || key == "BACKSLASH" {
                return "BackSlash"
            }
            if key == "]" || key == "RIGHTBRACKET" {
                return "RightBracket"
            }
            if key == "`" || key == "GRAVEACCENT" {
                return "GraveAccent"
            }
            if key == "CAPSLOCK" {
                return "CapsLock"
            }
            if key == "SCROLLLOCK" {
                return "ScrollLock"
            }
            if key == "NUMLOCK" {
                return "NumLock"
            }
            if key == "PRINTSCREEN" {
                return "PrintScreen"
            }
            if key == "PAUSE" {
                return "Pause"
            }
            if key == "MENU" {
                return "Menu"
            }
            if key.Length >= 2 && key[0] == char(70) {
                var number int32
                if Int32.TryParse(key.Substring(1), out number) && number >= 1 && number <= 25 {
                    return "F" + number.ToString()
                }
            }
            if key.Length == 1 && key[0] >= char(48) && key[0] <= char(57) {
                return "Number" + key
            }
            if key.Length == 7 && key.StartsWith("NUMBER")
            && key[6] >= char(48) && key[6] <= char(57) {
                return "Number" + key.Substring(6, 1)
            }
            if key.Length == 7 && key.StartsWith("KEYPAD")
            && key[6] >= char(48) && key[6] <= char(57) {
                return "Keypad" + key.Substring(6, 1)
            }
            if key == "KEYPADENTER" {
                return "KeypadEnter"
            }
            if key == "KEYPADDECIMAL" {
                return "KeypadDecimal"
            }
            if key == "KEYPADDIVIDE" {
                return "KeypadDivide"
            }
            if key == "KEYPADMULTIPLY" {
                return "KeypadMultiply"
            }
            if key == "KEYPADSUBTRACT" {
                return "KeypadSubtract"
            }
            if key == "KEYPADADD" {
                return "KeypadAdd"
            }
            if key == "KEYPADEQUAL" {
                return "KeypadEqual"
            }
            return ""
        }
    }
}
