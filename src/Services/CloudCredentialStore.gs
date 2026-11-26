package gloop

import System
import System.IO
import System.Text.Json

internal class CloudCredentialStore {
    internal let FilePath string

    internal init() {
        FilePath = Path.Combine(ResolveConfigHome(), "gloop", "cloud-google-drive.json")
    }

    internal init(path string) {
        FilePath = path
    }

    internal func Load() GoogleDriveConfig {
        let config = GoogleDriveConfig()

        if !File.Exists(FilePath) {
            return config
        }

        try {
            using let document = JsonDocument.Parse(File.ReadAllText(FilePath))
            let root = document.RootElement

            if root.ValueKind != JsonValueKind.Object {
                return config
            }

            config.ClientId = ReadString(root, "clientId", "")
            config.ClientSecret = ReadString(root, "clientSecret", "")
            config.ApiKey = ReadString(root, "apiKey", "")
            config.RootFolderId = ReadString(root, "rootFolderId", "root")
            config.AccessToken = ReadString(root, "accessToken", "")
            config.RefreshToken = ReadString(root, "refreshToken", "")
            config.AccessTokenExpiresAtUnix = ReadInt64(root, "accessTokenExpiresAtUnix", int64(0))
            config.AccountEmail = ReadString(root, "accountEmail", "")
            config.AccountName = ReadString(root, "accountName", "")
            config.StorageUsed = ReadInt64(root, "storageUsed", int64(0))
            config.StorageLimit = ReadInt64(root, "storageLimit", int64(0))
        } catch {
            return GoogleDriveConfig()
        }

        return config
    }

    internal func Save(config GoogleDriveConfig) string {
        try {
            let directory = Path.GetDirectoryName(FilePath)

            if !string.IsNullOrWhiteSpace(directory) {
                Directory.CreateDirectory(directory)
            }

            let tempPath = FilePath + ".tmp"
            using let buffer = MemoryStream()
            let options = JsonWriterOptions()
            options.Indented = true
            using let writer = Utf8JsonWriter(buffer, options)

            writer.WriteStartObject()
            writer.WriteString("clientId", config.ClientId ?? "")
            writer.WriteString("clientSecret", config.ClientSecret ?? "")
            writer.WriteString("apiKey", config.ApiKey ?? "")
            writer.WriteString("rootFolderId", config.EffectiveRootId())
            writer.WriteString("accessToken", config.AccessToken ?? "")
            writer.WriteString("refreshToken", config.RefreshToken ?? "")
            writer.WriteNumber("accessTokenExpiresAtUnix", config.AccessTokenExpiresAtUnix)
            writer.WriteString("accountEmail", config.AccountEmail ?? "")
            writer.WriteString("accountName", config.AccountName ?? "")
            writer.WriteNumber("storageUsed", config.StorageUsed)
            writer.WriteNumber("storageLimit", config.StorageLimit)
            writer.WriteEndObject()
            writer.Flush()
            File.WriteAllBytes(tempPath, buffer.ToArray())

            if OperatingSystem.IsLinux() {
                File.SetUnixFileMode(tempPath, UnixFileMode.UserRead | UnixFileMode.UserWrite)
            }

            File.Move(tempPath, FilePath, true)
            return ""
        } catch (ex Exception) {
            return "Could not save Google Drive credentials: " + ex.Message
        }
    }

    private func ReadString(root JsonElement, key string, fallback string) string {
        var value JsonElement

        if root.TryGetProperty(key, out value) && value.ValueKind == JsonValueKind.String {
            return value.GetString() ?? fallback
        }

        return fallback
    }

    private func ReadInt64(root JsonElement, key string, fallback int64) int64 {
        var value JsonElement

        if root.TryGetProperty(key, out value) && value.ValueKind == JsonValueKind.Number {
            var parsed = int64(0)

            if value.TryGetInt64(out parsed) {
                return parsed
            }
        }

        return fallback
    }

    private func ResolveConfigHome() string {
        let env = Environment.GetEnvironmentVariable("XDG_CONFIG_HOME")

        if !string.IsNullOrWhiteSpace(env) {
            return env
        }

        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config")
    }
}
