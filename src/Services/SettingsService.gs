package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class SettingsLoadResult {
    internal let Settings AppSettings
    internal let Error string

    internal init(settings AppSettings, error string) {
        Settings = settings
        Error = error
    }
}

internal class SettingsService {
    internal let FilePath string

    internal init(path string) {
        FilePath = path
    }

    internal func Load() SettingsLoadResult {
        let settings = AppSettings()
        if !File.Exists(FilePath) {
            return SettingsLoadResult(settings, "")
        }
        try {
            using let document = JsonDocument.Parse(File.ReadAllText(FilePath))
            let root = document.RootElement
            if root.ValueKind != JsonValueKind.Object {
                throw FormatException("Expected a JSON object")
            }
            let seen = HashSet[string](StringComparer.Ordinal)
            var hasThemeName = false
            var hasCustomTheme = false
            for property in root.EnumerateObject() {
                if !seen.Add(property.Name) {
                    throw FormatException("Duplicate setting: " + property.Name)
                }
                if property.Name == "showHidden" {
                    settings.ShowHidden = readBool(property.Value, property.Name)
                } else if property.Name == "showPreview" {
                    settings.ShowPreview = readBool(property.Value, property.Name)
                } else if property.Name == "previewWordWrap" {
                    settings.PreviewWordWrap = readBool(property.Value, property.Name)
                } else if property.Name == "previewLineNumbers" {
                    settings.PreviewLineNumbers = readBool(property.Value, property.Name)
                } else if property.Name == "splitView" {
                    settings.SplitView = readBool(property.Value, property.Name)
                } else if property.Name == "viewMode" {
                    if property.Value.ValueKind != JsonValueKind.String {
                        throw FormatException("viewMode must be a string")
                    }
                    settings.ViewMode = property.Value.GetString() ?? ""
                } else if property.Name == "smoothScrolling" {
                    settings.SmoothScrolling = readBool(property.Value, property.Name)
                } else if property.Name == "scrollSpeed" {
                    if property.Value.ValueKind != JsonValueKind.Number {
                        throw FormatException("scrollSpeed must be a number")
                    }
                    settings.ScrollSpeed = property.Value.GetDouble()
                } else if property.Name == "bookmarks" {
                    readBookmarks(settings, property.Value)
                } else if property.Name == "keybindings" {
                    readKeybindings(settings, property.Value)
                } else if property.Name == "theme" {
                    readTheme(settings.Theme, property.Value)
                } else if property.Name == "themeName" {
                    if property.Value.ValueKind != JsonValueKind.String {
                        throw FormatException("themeName must be a string")
                    }
                    settings.ThemeName = property.Value.GetString() ?? ""
                    hasThemeName = true
                } else if property.Name == "customTheme" {
                    readTheme(settings.CustomTheme, property.Value)
                    hasCustomTheme = true
                }
            }
            if isLegacyDefaultTheme(settings.Theme) {
                settings.Theme = ThemePalette()
            }
            if !hasThemeName {
                let preset = ThemePresets.Match(settings.Theme)
                settings.ThemeName = if preset == "" {
                    "Custom"
                } else {
                    preset
                }
            }
            if !hasCustomTheme && settings.ThemeName == "Custom" {
                settings.CustomTheme.ApplyFrom(settings.Theme)
            }
            let error = Validate(settings)
            if error != "" {
                throw FormatException(error)
            }
            return SettingsLoadResult(settings, "")
        } catch (e Exception) {
            return SettingsLoadResult(AppSettings(), "Could not load settings: " + e.Message)
        }
    }

    internal func Save(settings AppSettings) string {
        let error = Validate(settings)
        if error != "" {
            return error
        }
        if File.Exists(FilePath) {
            let existing = Load()
            if existing.Error != "" {
                return "Could not save settings: existing file is invalid"
            }
        }
        let temporary = FilePath + "." + Guid.NewGuid().ToString("N") + ".tmp"
        try {
            let parent = Path.GetDirectoryName(FilePath) ?? ""
            if parent != "" {
                Directory.CreateDirectory(parent)
            }
            {
                using let stream = File.Create(temporary)
                using let writer = Utf8JsonWriter(stream, JsonWriterOptions{Indented: true})
                writer.WriteStartObject()
                writer.WriteBoolean("showHidden", settings.ShowHidden)
                writer.WriteBoolean("showPreview", settings.ShowPreview)
                writer.WriteBoolean("previewWordWrap", settings.PreviewWordWrap)
                writer.WriteBoolean("previewLineNumbers", settings.PreviewLineNumbers)
                writer.WriteBoolean("splitView", settings.SplitView)
                writer.WriteString("viewMode", settings.ViewMode)
                writer.WriteBoolean("smoothScrolling", settings.SmoothScrolling)
                writer.WriteNumber("scrollSpeed", settings.ScrollSpeed)
                writer.WriteStartArray("bookmarks")
                for bookmark in settings.Bookmarks {
                    writer.WriteStringValue(bookmark)
                }
                writer.WriteEndArray()
                writer.WriteStartObject("keybindings")
                for binding in settings.Keybindings {
                    writer.WriteString(binding.Key, binding.Value)
                }
                writer.WriteEndObject()
                writer.WriteString("themeName", settings.ThemeName)
                writeTheme(writer, "theme", settings.Theme)
                writeTheme(writer, "customTheme", settings.CustomTheme)
                writer.WriteEndObject()
                writer.Flush()
            }
            File.Move(temporary, FilePath, true)
            return ""
        } catch (e Exception) {
            if File.Exists(temporary) {
                File.Delete(temporary)
            }
            return "Could not save settings: " + e.Message
        }
    }

    shared {
        internal func Default() SettingsService {
            var configHome = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME") ?? ""
            if configHome == "" || !Path.IsPathFullyQualified(configHome) {
                var home = Environment.GetEnvironmentVariable("HOME") ?? ""
                if home == "" || !Path.IsPathFullyQualified(home) {
                    home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                }
                configHome = Path.Combine(home, ".config")
            }
            return SettingsService(Path.Combine(configHome, "gloop", "settings.json"))
        }

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
                if BookmarkPath.Normalize(bookmark) != bookmark {
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
            if settings.ThemeName != "Custom" && !ThemePresets.Contains(settings.ThemeName) {
                return "Unknown theme: " + settings.ThemeName
            }
            if !validTheme(settings.Theme) || !validTheme(settings.CustomTheme) {
                return "Theme colors must be #RRGGBB"
            }
            return ""
        }

        private func validTheme(theme ThemePalette) bool ->
        validColor(theme.Background) && validColor(theme.Surface) && validColor(theme.Text)
        && validColor(theme.MutedText) && validColor(theme.Accent)
        && validColor(theme.Border) && validColor(theme.Selection)

        private func writeTheme(writer Utf8JsonWriter, name string, theme ThemePalette) {
            writer.WriteStartObject(name)
            writer.WriteString("background", theme.Background)
            writer.WriteString("surface", theme.Surface)
            writer.WriteString("text", theme.Text)
            writer.WriteString("mutedText", theme.MutedText)
            writer.WriteString("accent", theme.Accent)
            writer.WriteString("border", theme.Border)
            writer.WriteString("selection", theme.Selection)
            writer.WriteEndObject()
        }

        private func readBool(value JsonElement, name string) bool {
            if value.ValueKind == JsonValueKind.True {
                return true
            }
            if value.ValueKind == JsonValueKind.False {
                return false
            }
            throw FormatException(name + " must be true or false")
        }

        private func readKeybindings(settings AppSettings, value JsonElement) {
            if value.ValueKind != JsonValueKind.Object {
                throw FormatException("keybindings must be an object")
            }
            let seen = HashSet[string](StringComparer.Ordinal)
            let reserved = HashSet[string](StringComparer.Ordinal)
            for binding in settings.Keybindings {
                reserved.Add(binding.Value)
            }
            for property in value.EnumerateObject() {
                if !seen.Add(property.Name) {
                    throw FormatException("Duplicate action: " + property.Name)
                }
                if !settings.Keybindings.ContainsKey(property.Name) {
                    throw FormatException("Unknown action: " + property.Name)
                }
                if property.Value.ValueKind != JsonValueKind.String {
                    throw FormatException("Shortcut for " + property.Name + " must be a string")
                }
                let shortcut = Shortcut.Normalize(property.Value.GetString() ?? "")
                if shortcut == "" {
                    throw FormatException("Invalid shortcut for " + property.Name)
                }
                settings.Keybindings[property.Name] = shortcut
            }
            let assigned = HashSet[string](StringComparer.Ordinal)
            for action in seen {
                let shortcut = settings.Keybindings[action]
                if !assigned.Add(shortcut) {
                    throw FormatException("Duplicate shortcut: " + shortcut)
                }
            }
            let inherited = List[string]()
            for binding in settings.Keybindings {
                if !seen.Contains(binding.Key) {
                    inherited.Add(binding.Key)
                }
            }
            inherited.Sort(StringComparer.Ordinal)
            for action in inherited {
                let shortcut = settings.Keybindings[action]
                if assigned.Add(shortcut) {
                    continue
                }
                let fallback = availableShortcut(shortcut, assigned, reserved)
                settings.Keybindings[action] = fallback
                assigned.Add(fallback)
            }
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

        private func readBookmarks(settings AppSettings, value JsonElement) {
            if value.ValueKind != JsonValueKind.Array {
                throw FormatException("bookmarks must be an array")
            }
            let seen = HashSet[string](StringComparer.Ordinal)
            for entry in value.EnumerateArray() {
                if entry.ValueKind != JsonValueKind.String {
                    throw FormatException("bookmarks must contain folder paths")
                }
                let path = BookmarkPath.Normalize(entry.GetString() ?? "")
                if path == "" {
                    throw FormatException("Bookmark must be an absolute folder path")
                }
                if !seen.Add(path) {
                    throw FormatException("Duplicate bookmark: " + path)
                }
                settings.Bookmarks.Add(path)
            }
        }

        private func readTheme(theme ThemePalette, value JsonElement) {
            if value.ValueKind != JsonValueKind.Object {
                throw FormatException("theme must be an object")
            }
            let seen = HashSet[string](StringComparer.Ordinal)
            for property in value.EnumerateObject() {
                if !seen.Add(property.Name) {
                    throw FormatException("Duplicate theme color: " + property.Name)
                }
                if property.Value.ValueKind != JsonValueKind.String {
                    throw FormatException("Theme color " + property.Name + " must be a string")
                }
                let color = property.Value.GetString() ?? ""
                if !validColor(color) {
                    throw FormatException("Invalid theme color: " + property.Name)
                }
                if property.Name == "background" {
                    theme.Background = color
                } else if property.Name == "surface" {
                    theme.Surface = color
                } else if property.Name == "text" {
                    theme.Text = color
                } else if property.Name == "mutedText" {
                    theme.MutedText = color
                } else if property.Name == "accent" {
                    theme.Accent = color
                } else if property.Name == "border" {
                    theme.Border = color
                } else if property.Name == "selection" {
                    theme.Selection = color
                } else {
                    throw FormatException("Unknown theme color: " + property.Name)
                }
            }
        }

        private func validColor(value string) bool {
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
