package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class ThemePalette {
    internal var Background string
    internal var Surface string
    internal var Text string
    internal var MutedText string
    internal var Accent string
    internal var Border string
    internal var Selection string

    internal init() {
        Background = "#090B10"
        Surface = "#161A22"
        Text = "#ECEDED"
        MutedText = "#B8BFC9"
        Accent = "#478AD1"
        Border = "#2A303B"
        Selection = "#17273A"
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
    internal var LaunchShowHiddenOriginal bool?
    internal var ShowTypeColumn bool
    internal var ShowPreview bool
    internal var PreviewWordWrap bool
    internal var PreviewLineNumbers bool
    internal var SplitView bool
    internal var ViewMode string
    internal var SmoothScrolling bool
    internal var ScrollSpeed float64
    internal let Keybindings Dictionary[string, string]
    internal let UnknownKeybindings Dictionary[string, string]
    internal let UnknownSettings Dictionary[string, JsonElement]
    internal let Bookmarks List[string]
    internal var Theme ThemePalette
    internal var ThemeName string
    internal var CustomTheme ThemePalette

    internal init() {
        ShowHidden = false
        ShowTypeColumn = false
        ShowPreview = false
        PreviewWordWrap = true
        PreviewLineNumbers = true
        SplitView = false
        ViewMode = "list"
        SmoothScrolling = true
        ScrollSpeed = 1.5
        Theme = ThemePalette()
        ThemeName = "Glass"
        CustomTheme = Theme.Clone()
        Keybindings = Dictionary[string, string](StringComparer.Ordinal)
        UnknownKeybindings = Dictionary[string, string](StringComparer.Ordinal)
        UnknownSettings = Dictionary[string, JsonElement](StringComparer.Ordinal)
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
        Keybindings["ContextMenu"] = "Shift+F10"
        Keybindings["ContextMenuAlternate"] = "Menu"
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
        Keybindings["CopyPath"] = "Ctrl+Shift+C"
        Keybindings["Trash"] = "Delete"
        Keybindings["Properties"] = "Alt+Enter"
        Keybindings["Restore"] = "Ctrl+Shift+R"
        Keybindings["DeletePermanently"] = "Shift+Delete"
        Keybindings["EmptyTrash"] = "Ctrl+Shift+Delete"
        Keybindings["ShowInFolder"] = "Ctrl+Shift+O"
        Keybindings["Dismiss"] = "Escape"
        Keybindings["Quit"] = "Ctrl+Q"
        Keybindings["OpenSettings"] = "Ctrl+Comma"
    }

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
        LaunchShowHiddenOriginal = source.LaunchShowHiddenOriginal
        ShowTypeColumn = source.ShowTypeColumn
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
        UnknownKeybindings.Clear()
        for binding in source.UnknownKeybindings {
            UnknownKeybindings[binding.Key] = binding.Value
        }
        UnknownSettings.Clear()
        for setting in source.UnknownSettings {
            UnknownSettings[setting.Key] = setting.Value
        }
        Bookmarks.Clear()
        for bookmark in source.Bookmarks {
            Bookmarks.Add(bookmark)
        }
    }

    internal func ResetShortcuts() {
        let defaults = AppSettings()
        Keybindings.Clear()
        for binding in defaults.Keybindings {
            Keybindings[binding.Key] = binding.Value
        }
    }

    internal func ResetBehavior() {
        let defaults = AppSettings()
        SmoothScrolling = defaults.SmoothScrolling
        ScrollSpeed = defaults.ScrollSpeed
        PreviewWordWrap = defaults.PreviewWordWrap
        PreviewLineNumbers = defaults.PreviewLineNumbers
    }

    internal func ResetAppearance() {
        let defaults = AppSettings()
        Theme = defaults.Theme
        ThemeName = defaults.ThemeName
        CustomTheme = defaults.CustomTheme
    }

    internal func SelectTheme(name string) {
        ThemeName = name
        if name == "Custom" {
            Theme.ApplyFrom(CustomTheme)
        } else {
            Theme = ThemePresets.Create(name)
        }
    }

    internal func SetCustomColor(role string, color string) {
        CustomTheme.SetColor(role, color)
        Theme.SetColor(role, color)
    }

    internal func ResolveTheme(hasThemeName bool, hasCustomTheme bool) {
        if isLegacyDefaultTheme(Theme) {
            Theme = ThemePalette()
        }
        if !hasThemeName {
            let preset = ThemePresets.Match(Theme)
            ThemeName = if preset == "" {
                "Custom"
            } else {
                preset
            }
        }
        if ThemePresets.Contains(ThemeName) {
            Theme = ThemePresets.Create(ThemeName)
        }
        if !hasCustomTheme && ThemeName == "Custom" {
            CustomTheme.ApplyFrom(Theme)
        }
    }

    internal func ReadBindings(bindings Dictionary[string, string]) {
        let reserved = HashSet[string](Keybindings.Values, StringComparer.Ordinal)
        for binding in bindings {
            let shortcut = Shortcut.Normalize(binding.Value)
            if shortcut == "" {
                throw FormatException("Invalid shortcut for " + binding.Key)
            }
            if Keybindings.ContainsKey(binding.Key) {
                Keybindings[binding.Key] = shortcut
            } else {
                UnknownKeybindings[binding.Key] = shortcut
            }
        }
        let assigned = HashSet[string](StringComparer.Ordinal)
        for binding in bindings {
            if !Keybindings.ContainsKey(binding.Key) {
                continue
            }
            let shortcut = Keybindings[binding.Key]
            if !assigned.Add(shortcut) {
                throw FormatException("Duplicate shortcut: " + shortcut)
            }
        }
        let inherited = List[string]()
        for binding in Keybindings {
            if !bindings.ContainsKey(binding.Key) {
                inherited.Add(binding.Key)
            }
        }
        inherited.Sort(StringComparer.Ordinal)
        for action in inherited {
            let shortcut = Keybindings[action]
            if assigned.Add(shortcut) {
                continue
            }
            let fallback = availableShortcut(shortcut, assigned, reserved)
            Keybindings[action] = fallback
            assigned.Add(fallback)
        }
    }

    shared {
        internal func Validate(settings AppSettings) string {
            if settings.ViewMode != "list" && settings.ViewMode != "tiles" {
                return "View mode must be list or tiles"
            }
            if !Double.IsFinite(settings.ScrollSpeed) || settings.ScrollSpeed < 0.25
            || settings.ScrollSpeed > 4.0 {
                return "Scroll speed must be between 0.25 and 4.0"
            }
            let seenBookmarks = HashSet[string](StringComparer.Ordinal)
            for bookmark in settings.Bookmarks {
                if bookmark == "" || BookmarkPath.Normalize(bookmark) != bookmark {
                    return "Bookmark paths must be normalized absolute paths"
                }
                if !seenBookmarks.Add(bookmark) {
                    return "Duplicate bookmark: " + bookmark
                }
            }
            let defaults = AppSettings()
            if settings.Keybindings.Count != defaults.Keybindings.Count {
                return "Every action needs a binding"
            }
            let used = HashSet[string](StringComparer.Ordinal)
            for binding in settings.Keybindings {
                if !defaults.Keybindings.ContainsKey(binding.Key) {
                    return "Unknown action: " + binding.Key
                }
                let normalized = Shortcut.Normalize(binding.Value)
                if normalized == "" || normalized != binding.Value {
                    return "Invalid shortcut for " + binding.Key
                }
                if !used.Add(binding.Value) {
                    return "Duplicate shortcut: " + binding.Value
                }
            }
            used.Clear()
            for binding in settings.UnknownKeybindings {
                if defaults.Keybindings.ContainsKey(binding.Key) {
                    return "Known action in unknown bindings: " + binding.Key
                }
                let normalized = Shortcut.Normalize(binding.Value)
                if normalized == "" || normalized != binding.Value {
                    return "Invalid shortcut for " + binding.Key
                }
                if !used.Add(binding.Value) {
                    return "Duplicate shortcut: " + binding.Value
                }
            }
            if settings.ThemeName != "Custom" && !ThemePresets.Contains(settings.ThemeName) {
                return "Unknown theme: " + settings.ThemeName
            }
            if !validTheme(settings.Theme) || !validTheme(settings.CustomTheme) {
                return "Theme colors must be #RRGGBB"
            }
            return ""
        }

        private func validTheme(theme ThemePalette) bool ->
        ValidColor(theme.Background) && ValidColor(theme.Surface) && ValidColor(theme.Text)
        && ValidColor(theme.MutedText) && ValidColor(theme.Accent)
        && ValidColor(theme.Border) && ValidColor(theme.Selection)

        internal func ValidColor(value string) bool {
            if value.Length != 7 || value[0] != char(35) {
                return false
            }
            for i in 1 ... value.Length {
                let c = value[i]
                if !(c >= char(48) && c <= char(57))
                && !(c >= char(65) && c <= char(70))
                && !(c >= char(97) && c <= char(102)) {
                    return false
                }
            }
            return true
        }

        private func availableShortcut(preferred string, assigned HashSet[string], reserved HashSet[string]) string {
            let key = preferred.Substring(preferred.LastIndexOf(char(43)) + 1)
            let first = "Ctrl+Shift+" + key
            if Shortcut.Normalize(first) == first && !assigned.Contains(first)
            && !reserved.Contains(first) {
                return first
            }
            for code in 65 ... 91 {
                let candidate = "Ctrl+Shift+" + char(code).ToString()
                if !assigned.Contains(candidate) && !reserved.Contains(candidate) {
                    return candidate
                }
            }
            for number in 1 ... 26 {
                let candidate = "Ctrl+Shift+F" + number.ToString()
                if !assigned.Contains(candidate) && !reserved.Contains(candidate) {
                    return candidate
                }
            }
            throw FormatException("No shortcut available for " + preferred)
        }

        private func isLegacyDefaultTheme(theme ThemePalette) bool ->
        String.Equals(theme.Background, "#111418", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.Surface, "#181D23", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.Text, "#E8EDF2", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.MutedText, "#919CAA", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.Accent, "#8DD9C4", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.Border, "#2A323D", StringComparison.OrdinalIgnoreCase)
        && String.Equals(theme.Selection, "#25493F", StringComparison.OrdinalIgnoreCase)
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
