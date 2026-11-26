package gloop

import System
import System.Collections.Generic
import System.IO
import System.Net.Http
import System.Text
import System.Text.Json

internal partial class GoogleDriveService {
    private let _store CloudCredentialStore
    private let _auth GoogleDriveAuthService = GoogleDriveAuthService()
    private let _http HttpClient = HttpClient()
    private let _sync Object = Object()
    private let _metaCache Dictionary[string, DriveItemMeta] = Dictionary[string, DriveItemMeta](StringComparer.Ordinal)
    private let _cacheDir string
    private var _config GoogleDriveConfig

    internal init() {
        _store = CloudCredentialStore()
        _config = _store.Load()
        _cacheDir = Path.Combine(Path.GetTempPath(), "gloop-cloud-cache")
        _http.Timeout = TimeSpan.FromSeconds(45)
    }

    internal func ConfigSnapshot() GoogleDriveConfig {
        lock _sync {
            return _config.Clone()
        }
    }

    internal func IsConfigured() bool {
        lock _sync {
            return _config.IsConfigured()
        }
    }

    internal func IsSignedIn() bool {
        lock _sync {
            return _config.IsSignedIn()
        }
    }

    internal func UpdateSettings(clientId string, clientSecret string, apiKey string, rootFolderId string) string {
        lock _sync {
            _config.ClientId = (clientId ?? "").Trim()
            _config.ClientSecret = (clientSecret ?? "").Trim()
            _config.ApiKey = (apiKey ?? "").Trim()
            let root = (rootFolderId ?? "").Trim()
            _config.RootFolderId = root == "" ? "root": root
            return _store.Save(_config)
        }
    }

    internal func SignIn(clientId string, clientSecret string, apiKey string, rootFolderId string) string {
        let err = UpdateSettings(clientId, clientSecret, apiKey, rootFolderId)

        if err != "" {
            return err
        }

        let working = ConfigSnapshot()
        let signInErr = _auth.SignIn(_http, working, _store)

        if signInErr == "" {
            lock _sync {
                _config = working
            }
        }

        return signInErr
    }

    internal func CancelSignIn() {
        _auth.CancelSignIn()
    }

    internal func TestApiKey(apiKey string, rootFolderId string) string -> _auth.TestApiKey(_http, apiKey, rootFolderId)

    internal func RefreshAccountStatus() string {
        let working = ConfigSnapshot()

        if !working.IsSignedIn() {
            return ""
        }

        let authErr = _auth.EnsureValidToken(_http, working, _store)

        if authErr != "" {
            return authErr
        }

        let aboutErr = _auth.FetchAbout(_http, working)

        if aboutErr == "" {
            _store.Save(working)
            lock _sync {
                _config = working
            }
        }

        return aboutErr
    }

    internal func Disconnect() string {
        lock _sync {
            _config.ClearTokens()
            _metaCache.Clear()
            return _store.Save(_config)
        }
    }

    internal func ResolveFolderId(path string) string {
        let id = Locations.CloudId(path)

        if id == "root" || id == "" {
            return ConfigSnapshot().EffectiveRootId()
        }

        return id
    }

    internal func GetCachedMeta(fileId string) DriveItemMeta? {
        lock _sync {
            var meta DriveItemMeta? = nil

            if _metaCache.TryGetValue(fileId, out meta) {
                return meta
            }

            return nil
        }
    }

    internal func BreadcrumbChain(path string) List[KeyValuePair[string, string]] {
        let result = List[KeyValuePair[string, string]]()
        let rootId = ConfigSnapshot().EffectiveRootId()
        var currentId = ResolveFolderId(path)
        let reversed = List[KeyValuePair[string, string]]()
        var guardCount = 0

        while currentId != "" && currentId != rootId && currentId != "root" && guardCount < 16 {
            let meta = GetCachedMeta(currentId)

            if meta == nil {
                break
            }

            reversed.Add(KeyValuePair[string, string](Locations.CloudPath(currentId), meta.Name))
            currentId = meta.ParentId
            guardCount++
        }

        result.Add(KeyValuePair[string, string](Locations.GoogleDriveRoot, "Google Drive"))

        var i = reversed.Count - 1

        while i >= 0 {
            result.Add(reversed[i])
            i--
        }

        return result
    }

    internal func ParentPath(path string) string {
        let rootId = ConfigSnapshot().EffectiveRootId()
        let currentId = ResolveFolderId(path)

        if currentId == "" || currentId == rootId || currentId == "root" {
            return Locations.GoogleDriveRoot
        }

        let meta = GetCachedMeta(currentId)

        if meta != nil && meta.ParentId != "" && meta.ParentId != rootId && meta.ParentId != "root" {
            return Locations.CloudPath(meta.ParentId)
        }

        return Locations.GoogleDriveRoot
    }

    internal func ListFolder(path string, includeHidden bool, out items List[FileEntry], out error string) bool {
        items = List[FileEntry]()
        error = ""
        let config = PrepareConfig(out error)

        if error != "" {
            return false
        }

        let folderId = ResolveFolderId(path)
        let query = "'" + EscapeQuery(folderId) + "' in parents and trashed = false"
        var pageToken = ""

        while true {
            var url = GoogleDriveAuthService.ApiBaseUrl() + "/files?q=" + Uri.EscapeDataString(query) +
                "&fields=" +
                Uri
                .EscapeDataString(
                "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,parents,capabilities(canRename,canTrash),thumbnailLink,webViewLink,shortcutDetails(targetId,targetMimeType))"
            ) +
                "&pageSize=200&orderBy=folder,name_natural"

            if pageToken != "" {
                url += "&pageToken=" + Uri.EscapeDataString(pageToken)
            }

            using let request = CreateAuthorizedRequest(HttpMethod.Get, url, config)
            using let response = _http.Send(request)
            let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

            if !response.IsSuccessStatusCode {
                error = "Could not list Google Drive folder: " + GoogleDriveAuthService.ExtractApiError(
                    body,
                    response.StatusCode
                )
                return false
            }

            using let doc = JsonDocument.Parse(body)
            let root = doc.RootElement
            var files JsonElement

            if root.TryGetProperty("files", out files) && files.ValueKind == JsonValueKind.Array {
                for item in files.EnumerateArray() {
                    let meta = ParseDriveMeta(item, folderId)

                    if !includeHidden && meta.Name.StartsWith(".") {
                        continue
                    }

                    CacheMeta(meta)
                    items.Add(ToFileEntry(meta))
                }
            }

            pageToken = ReadString(root, "nextPageToken", "")

            if pageToken == "" {
                break
            }
        }

        return true
    }

    internal func CreateFolder(parentPath string, name string) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let parentId = ResolveFolderId(parentPath)
        let url = AppendApiKey(GoogleDriveAuthService.ApiBaseUrl() + "/files?fields=id,name,mimeType,parents", config)
        let payload = BuildMetadataJson(name, "application/vnd.google-apps.folder", parentId)
        using let request = CreateAuthorizedRequest(HttpMethod.Post, url, config)
        request.Content = StringContent(payload, Encoding.UTF8, "application/json")
        using let response = _http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not create folder \"" + name + "\": " + GoogleDriveAuthService.ExtractApiError(
                body,
                response.StatusCode
            )
        }

        return ""
    }

    internal func Rename(cloudPath string, newName string) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(cloudPath)
        let url = AppendApiKey(GoogleDriveAuthService.ApiBaseUrl() + "/files/" + Uri.EscapeDataString(fileId), config)
        let payload = BuildMetadataJson(newName, "", "")
        using let request = CreateAuthorizedRequest(HttpMethod.Patch, url, config)
        request.Content = StringContent(payload, Encoding.UTF8, "application/json")
        using let response = _http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not rename item: " + GoogleDriveAuthService.ExtractApiError(body, response.StatusCode)
        }

        return ""
    }

    internal func Trash(cloudPath string) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(cloudPath)
        let url = AppendApiKey(GoogleDriveAuthService.ApiBaseUrl() + "/files/" + Uri.EscapeDataString(fileId), config)
        using let request = CreateAuthorizedRequest(HttpMethod.Patch, url, config)
        request.Content = StringContent("{\"trashed\":true}", Encoding.UTF8, "application/json")
        using let response = _http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not move item to Trash: " + GoogleDriveAuthService.ExtractApiError(body, response.StatusCode)
        }

        return ""
    }

    internal func CopyCloudToCloud(sourceCloudPath string, targetParentCloudPath string, newName string) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(sourceCloudPath)
        let targetId = ResolveFolderId(targetParentCloudPath)
        let url = AppendApiKey(
            GoogleDriveAuthService.ApiBaseUrl() + "/files/" + Uri.EscapeDataString(fileId) + "/copy",
            config
        )
        let payload = BuildMetadataJson(newName, "", targetId)
        using let request = CreateAuthorizedRequest(HttpMethod.Post, url, config)
        request.Content = StringContent(payload, Encoding.UTF8, "application/json")
        using let response = _http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not copy item: " + GoogleDriveAuthService.ExtractApiError(body, response.StatusCode)
        }

        return ""
    }

    internal func Dispose() {
        _auth.CancelSignIn()
        _http.Dispose()
    }
}
