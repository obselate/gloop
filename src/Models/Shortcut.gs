package gloop

import System

internal data struct Shortcut {
    internal var Key string
    internal var Ctrl bool
    internal var Alt bool
    internal var Shift bool
    internal var Super bool

    shared {
        internal func Parse(value string) Shortcut {
            let normalized = Normalize(value)
            return Shortcut{
                Key: normalized.Substring(normalized.LastIndexOf(char(43)) + 1),
                Ctrl: normalized.Contains("Ctrl+"),
                Alt: normalized.Contains("Alt+"),
                Shift: normalized.Contains("Shift+"),
                Super: normalized.Contains("Super+")
            }
        }

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
            let alias = KeyAlias(key)
            if alias != "" {
                return alias
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

        private func KeyAlias(key string) string {
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
            return ""
        }
    }
}
