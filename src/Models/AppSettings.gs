package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class AppSettings {
    internal var ShowHidden bool
    internal var LaunchShowHiddenOriginal bool?
    internal var ShowTypeColumn bool
    internal var ShowPreview bool
    internal var PreviewWordWrap bool
    internal var PreviewLineNumbers bool
    internal var SplitView bool
    internal var ViewMode ViewMode
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
        ViewMode = ViewMode.List
        SmoothScrolling = true
        ScrollSpeed = 1.5
        Theme = ThemePalette()
        ThemeName = "Glass"
        CustomTheme = Theme.Clone()
        Keybindings = Dictionary[string, string](ActionCatalog.Count, StringComparer.Ordinal)
        UnknownKeybindings = Dictionary[string, string](StringComparer.Ordinal)
        UnknownSettings = Dictionary[string, JsonElement](StringComparer.Ordinal)
        Bookmarks = List[string]()
        for action in ActionCatalog {
            Keybindings[action.Key] = action.Value.Default
        }
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
        if name == CustomThemeName {
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
                CustomThemeName
            } else {
                preset
            }
        }
        if ThemePresets.Contains(ThemeName) {
            Theme = ThemePresets.Create(ThemeName)
        }
        if !hasCustomTheme && ThemeName == CustomThemeName {
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
        internal let ActionCatalog Dictionary[string, KeybindingAction] = map[string, KeybindingAction]{
            "MoveUp": KeybindingAction{Label: "Move Up", Default: "Up"},
            "MoveDown": KeybindingAction{Label: "Move Down", Default: "Down"},
            "MoveLeft": KeybindingAction{Label: "Move Left", Default: "Left"},
            "MoveRight": KeybindingAction{Label: "Move Right", Default: "Right"},
            "MoveFirst": KeybindingAction{Label: "Move First", Default: "Home"},
            "MoveLast": KeybindingAction{Label: "Move Last", Default: "End"},
            "PageUp": KeybindingAction{Label: "Page Up", Default: "PageUp"},
            "PageDown": KeybindingAction{Label: "Page Down", Default: "PageDown"},
            "Open": KeybindingAction{Label: "Open", Default: "Enter"},
            "ContextMenu": KeybindingAction{Label: "Open context menu", Default: "Shift+F10"},
            "ContextMenuAlternate": KeybindingAction{Label: "Open context menu (alternate)", Default: "Menu"},
            "SelectAll": KeybindingAction{Label: "Select All", Default: "Ctrl+A"},
            "ToggleSelection": KeybindingAction{Label: "Toggle Selection", Default: "Ctrl+Space"},
            "OpenTerminal": KeybindingAction{Label: "Open Terminal", Default: "F4"},
            "OpenTerminalHere": KeybindingAction{Label: "Open Terminal Here", Default: "Ctrl+F4"},
            "ViewList": KeybindingAction{Label: "View List", Default: "Ctrl+Number1"},
            "ViewTiles": KeybindingAction{Label: "View Tiles", Default: "Ctrl+Number2"},
            "Parent": KeybindingAction{Label: "Parent", Default: "Alt+Up"},
            "Back": KeybindingAction{Label: "Back", Default: "Alt+Left"},
            "Forward": KeybindingAction{Label: "Forward", Default: "Alt+Right"},
            "FocusLocation": KeybindingAction{Label: "Focus Location", Default: "Ctrl+L"},
            "FocusFilter": KeybindingAction{Label: "Focus Filter", Default: "Ctrl+F"},
            "TogglePreview": KeybindingAction{Label: "Toggle Preview", Default: "Space"},
            "ToggleSplit": KeybindingAction{Label: "Toggle Split", Default: "Ctrl+S"},
            "NextPane": KeybindingAction{Label: "Next Pane", Default: "Ctrl+Tab"},
            "FocusNext": KeybindingAction{Label: "Focus Next", Default: "Tab"},
            "FocusPrevious": KeybindingAction{Label: "Focus Previous", Default: "Shift+Tab"},
            "ToggleHidden": KeybindingAction{Label: "Toggle Hidden", Default: "Ctrl+H"},
            "ToggleTypeColumn": KeybindingAction{Label: "Toggle Type Column", Default: "Ctrl+Shift+T"},
            "ToggleBookmark": KeybindingAction{Label: "Toggle Bookmark", Default: "Ctrl+D"},
            "OpenBookmarks": KeybindingAction{Label: "Open Bookmarks", Default: "Ctrl+B"},
            "Refresh": KeybindingAction{Label: "Refresh", Default: "F5"},
            "NewFolder": KeybindingAction{Label: "New Folder", Default: "Ctrl+Shift+N"},
            "Rename": KeybindingAction{Label: "Rename", Default: "F2"},
            "Copy": KeybindingAction{Label: "Copy", Default: "Ctrl+C"},
            "Cut": KeybindingAction{Label: "Cut", Default: "Ctrl+X"},
            "Paste": KeybindingAction{Label: "Paste", Default: "Ctrl+V"},
            "CopyPath": KeybindingAction{Label: "Copy Path", Default: "Ctrl+Shift+C"},
            "Trash": KeybindingAction{Label: "Trash", Default: "Delete"},
            "Properties": KeybindingAction{Label: "Properties", Default: "Alt+Enter"},
            "Restore": KeybindingAction{Label: "Restore", Default: "Ctrl+Shift+R"},
            "DeletePermanently": KeybindingAction{Label: "Delete Permanently", Default: "Shift+Delete"},
            "EmptyTrash": KeybindingAction{Label: "Empty Trash", Default: "Ctrl+Shift+Delete"},
            "ShowInFolder": KeybindingAction{Label: "Show In Folder", Default: "Ctrl+Shift+O"},
            "Dismiss": KeybindingAction{Label: "Dismiss", Default: "Escape"},
            "Quit": KeybindingAction{Label: "Quit", Default: "Ctrl+Q"},
            "OpenSettings": KeybindingAction{Label: "Open Settings", Default: "Ctrl+Comma"},
        }

        internal const CustomThemeName string = "Custom"
        internal const MinimumScrollSpeed float64 = 0.25
        internal const MaximumScrollSpeed float64 = 4.0

        internal func ParseViewMode(value string) ViewMode {
            switch value {
                case "list" {
                    return ViewMode.List
                }
                case "tiles" {
                    return ViewMode.Tiles
                }
                default {
                    throw FormatException("View mode must be list or tiles")
                }
            }
        }

        internal func Validate(settings AppSettings) string {
            if settings.ViewMode != ViewMode.List && settings.ViewMode != ViewMode.Tiles {
                return "View mode must be list or tiles"
            }
            if !Double.IsFinite(settings.ScrollSpeed) || settings.ScrollSpeed < MinimumScrollSpeed
            || settings.ScrollSpeed > MaximumScrollSpeed {
                return "Scroll speed must be between " + MinimumScrollSpeed.ToString(
                    "0.00",
                    System.Globalization.CultureInfo.InvariantCulture
                )
                + " and " + MaximumScrollSpeed.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture)
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
            if settings.ThemeName != CustomThemeName && !ThemePresets.Contains(settings.ThemeName) {
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
