package gloop

import System
import System.Text.Json

internal class GoogleDriveConfig {
    internal var ClientId string = ""
    internal var ClientSecret string = ""
    internal var ApiKey string = ""
    internal var RootFolderId string = "root"
    internal var AccessToken string = ""
    internal var RefreshToken string = ""
    internal var AccessTokenExpiresAtUnix int64 = 0
    internal var AccountEmail string = ""
    internal var AccountName string = ""
    internal var StorageUsed int64 = 0
    internal var StorageLimit int64 = 0

    internal func IsSignedIn() bool -> !string.IsNullOrWhiteSpace(RefreshToken) || !string.IsNullOrWhiteSpace(
        AccessToken
    )

    internal func IsConfigured() bool -> IsSignedIn() || !string.IsNullOrWhiteSpace(ApiKey)

    internal func EffectiveRootId() string {
        let trimmed = (RootFolderId ?? "").Trim()
        return trimmed == "" ? "root": trimmed
    }

    internal func ClearTokens() {
        AccessToken = ""
        RefreshToken = ""
        AccessTokenExpiresAtUnix = int64(0)
        AccountEmail = ""
        AccountName = ""
        StorageUsed = int64(0)
        StorageLimit = int64(0)
    }

    internal func Clone() GoogleDriveConfig {
        let copy = GoogleDriveConfig()
        copy.ClientId = ClientId
        copy.ClientSecret = ClientSecret
        copy.ApiKey = ApiKey
        copy.RootFolderId = RootFolderId
        copy.AccessToken = AccessToken
        copy.RefreshToken = RefreshToken
        copy.AccessTokenExpiresAtUnix = AccessTokenExpiresAtUnix
        copy.AccountEmail = AccountEmail
        copy.AccountName = AccountName
        copy.StorageUsed = StorageUsed
        copy.StorageLimit = StorageLimit
        return copy
    }
}

internal class OAuthClientCredentials {
    internal let ClientId string
    internal let ClientSecret string
    internal let Error string

    internal init(clientId string, clientSecret string, error string) {
        ClientId = clientId
        ClientSecret = clientSecret
        Error = error
    }
}

internal class DriveItemMeta {
    internal let Id string
    internal let Name string
    internal let MimeType string
    internal let ParentId string
    internal let Size int64
    internal let Created DateTime
    internal let Modified DateTime
    internal let IsFolder bool
    internal let IsShortcut bool
    internal let ShortcutTargetId string
    internal let ShortcutTargetMimeType string
    internal let CanRename bool
    internal let CanTrash bool
    internal let ThumbnailLink string
    internal let WebViewLink string

    internal init(
        id string,
        name string,
        mimeType string,
        parentId string,
        size int64,
        created DateTime,
        modified DateTime,
        isFolder bool,
        isShortcut bool,
        shortcutTargetId string,
        shortcutTargetMimeType string,
        canRename bool,
        canTrash bool,
        thumbnailLink string,
        webViewLink string
    ) {
        Id = id
        Name = name
        MimeType = mimeType
        ParentId = parentId
        Size = size
        Created = created
        Modified = modified
        IsFolder = isFolder
        IsShortcut = isShortcut
        ShortcutTargetId = shortcutTargetId
        ShortcutTargetMimeType = shortcutTargetMimeType
        CanRename = canRename
        CanTrash = canTrash
        ThumbnailLink = thumbnailLink
        WebViewLink = webViewLink
    }

    internal func IsGoogleDoc() bool -> MimeType.StartsWith(
        "application/vnd.google-apps.",
        StringComparison.OrdinalIgnoreCase
    ) &&
        !IsFolder &&
        !IsShortcut
}

internal class CloudAccountHelpers {
    shared {
        internal func ParseOAuthClientJson(raw string) OAuthClientCredentials {
            if string.IsNullOrWhiteSpace(raw) {
                return OAuthClientCredentials("", "", "Clipboard is empty.")
            }

            try {
                using let document = JsonDocument.Parse(raw)
                var root = document.RootElement

                if root.ValueKind != JsonValueKind.Object {
                    return OAuthClientCredentials("", "", "OAuth JSON must be an object.")
                }

                var installed JsonElement
                var web JsonElement

                if root.TryGetProperty("installed", out installed) && installed.ValueKind == JsonValueKind.Object {
                    root = installed
                } else if root.TryGetProperty("web", out web) && web.ValueKind == JsonValueKind.Object {
                    root = web
                }

                var clientId = ""
                var clientSecret = ""
                var prop JsonElement

                if root.TryGetProperty("client_id", out prop) && prop.ValueKind == JsonValueKind.String {
                    clientId = prop.GetString() ?? ""
                }

                if root.TryGetProperty("client_secret", out prop) && prop.ValueKind == JsonValueKind.String {
                    clientSecret = prop.GetString() ?? ""
                }

                if string.IsNullOrWhiteSpace(clientId) {
                    return OAuthClientCredentials("", "", "OAuth JSON is missing client_id.")
                }

                return OAuthClientCredentials(clientId.Trim(), clientSecret.Trim(), "")
            } catch (ex Exception) {
                return OAuthClientCredentials("", "", "Invalid OAuth JSON: " + ex.Message)
            }
        }
    }
}
