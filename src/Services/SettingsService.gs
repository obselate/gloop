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
                } else if property.Name == "showTypeColumn" {
                    settings.ShowTypeColumn = readBool(property.Value, property.Name)
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
                } else {
                    settings.UnknownSettings[property.Name] = property.Value.Clone()
                }
            }
            settings.ResolveTheme(hasThemeName, hasCustomTheme)
            let error = AppSettings.Validate(settings)
            if error != "" {
                throw FormatException(error)
            }
            return SettingsLoadResult(settings, "")
        } catch (e Exception) {
            return SettingsLoadResult(AppSettings(), "Could not load settings: " + e.Message)
        }
    }

    internal func Save(settings AppSettings) string {
        let error = AppSettings.Validate(settings)
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
                writer.WriteBoolean("showHidden", settings.LaunchShowHiddenOriginal ?? settings.ShowHidden)
                writer.WriteBoolean("showTypeColumn", settings.ShowTypeColumn)
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
                for binding in settings.UnknownKeybindings {
                    writer.WriteString(binding.Key, binding.Value)
                }
                writer.WriteEndObject()
                writer.WriteString("themeName", settings.ThemeName)
                writeTheme(writer, "theme", settings.Theme)
                writeTheme(writer, "customTheme", settings.CustomTheme)
                for setting in settings.UnknownSettings {
                    writer.WritePropertyName(setting.Key)
                    setting.Value.WriteTo(writer)
                }
                writer.WriteEndObject()
                writer.Flush()
                stream.Flush(true)
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
        internal func Default() SettingsService -> SettingsService(
            Path.Combine(Xdg.ConfigHome(), "gloop", "settings.json")
        )

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
            let bindings = Dictionary[string, string](StringComparer.Ordinal)
            for property in value.EnumerateObject() {
                if bindings.ContainsKey(property.Name) {
                    throw FormatException("Duplicate action: " + property.Name)
                }
                if property.Value.ValueKind != JsonValueKind.String {
                    throw FormatException("Shortcut for " + property.Name + " must be a string")
                }
                bindings[property.Name] = property.Value.GetString() ?? ""
            }
            settings.ReadBindings(bindings)
        }

        private func readBookmarks(settings AppSettings, value JsonElement) {
            if value.ValueKind != JsonValueKind.Array {
                throw FormatException("bookmarks must be an array")
            }
            for entry in value.EnumerateArray() {
                if entry.ValueKind != JsonValueKind.String {
                    throw FormatException("bookmarks must contain folder paths")
                }
                settings.Bookmarks.Add(BookmarkPath.Normalize(entry.GetString() ?? ""))
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
                if !AppSettings.ValidColor(color) {
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
    }
}
