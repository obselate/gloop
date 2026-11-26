package gloop

import System
import System.Diagnostics
import System.Globalization
import System.IO
import System.Net.Http
import System.Net.Http.Headers
import System.Text
import System.Text.Json

internal partial class GoogleDriveService {
    internal func DownloadTo(cloudPath string, localPath string, shouldCancel Func[bool]? = nil) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(cloudPath)
        let meta = EnsureMeta(fileId, config)
        let url = BuildDownloadUrl(fileId, meta)
        let finalPath = ResolveExportLocalPath(localPath, meta)
        let dir = Path.GetDirectoryName(finalPath)

        if !string.IsNullOrWhiteSpace(dir) {
            Directory.CreateDirectory(dir)
        }

        using let request = CreateAuthorizedRequest(HttpMethod.Get, url, config)
        using let response = _http.Send(request, HttpCompletionOption.ResponseHeadersRead)

        if !response.IsSuccessStatusCode {
            let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            return "Could not download \"" + Path.GetFileName(localPath) +
                "\": " +
                GoogleDriveAuthService.ExtractApiError(body, response.StatusCode)
        }

        using let src = response.Content.ReadAsStream()
        using let dst = File.Create(finalPath)

        if shouldCancel != nil && shouldCancel() {
            return "Operation cancelled."
        }

        src.CopyTo(dst)
        return ""
    }

    internal func UploadFrom(
        localPath string,
        parentCloudPath string,
        fileName string,
        shouldCancel Func[bool]? = nil
    ) string {
        if shouldCancel != nil && shouldCancel() {
            return "Operation cancelled."
        }

        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        if !File.Exists(localPath) {
            return "Source file does not exist: " + localPath
        }

        let parentId = ResolveFolderId(parentCloudPath)
        let url = AppendApiKey(
            GoogleDriveAuthService.UploadBaseUrl() + "/files?uploadType=multipart&fields=id,name",
            config
        )
        let metadataJson = BuildMetadataJson(fileName, "", parentId)
        let boundary = "gloop-" + Guid.NewGuid().ToString("N")
        using let multipart = MultipartContent("related", boundary)
        let metaContent = StringContent(metadataJson, Encoding.UTF8, "application/json")
        multipart.Add(metaContent)
        using let fileStream = File.OpenRead(localPath)
        let fileContent = StreamContent(fileStream)
        fileContent.Headers.ContentType = MediaTypeHeaderValue("application/octet-stream")
        multipart.Add(fileContent)

        using let request = CreateAuthorizedRequest(HttpMethod.Post, url, config)
        request.Content = multipart
        using let response = _http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not upload \"" + fileName + "\": " + GoogleDriveAuthService.ExtractApiError(
                body,
                response.StatusCode
            )
        }

        return ""
    }

    internal func DownloadForPreview(
        cloudPath string,
        name string,
        shouldCancel Func[bool]?,
        out localPath string
    ) string {
        localPath = ""
        let fileId = Locations.CloudId(cloudPath)
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let meta = EnsureMeta(fileId, config)
        let fallbackName = meta != nil ? meta.Name: fileId
        let safeName = SanitizeFileName(name == "" ? fallbackName: name)
        let targetDir = Path.Combine(_cacheDir, "preview", SanitizeFileName(fileId))
        Directory.CreateDirectory(targetDir)
        let candidate = ResolveExportLocalPath(Path.Combine(targetDir, safeName), meta)

        if File.Exists(candidate) {
            localPath = candidate
            return ""
        }

        let dlErr = DownloadTo(cloudPath, candidate, shouldCancel)

        if dlErr != "" {
            return dlErr
        }

        localPath = candidate
        return ""
    }

    internal func DownloadThumbnail(cloudPath string, shouldCancel Func[bool]? = nil) string {
        let fileId = Locations.CloudId(cloudPath)
        let meta = GetCachedMeta(fileId)

        if meta == nil || string.IsNullOrWhiteSpace(meta.ThumbnailLink) {
            return ""
        }

        let thumbDir = Path.Combine(_cacheDir, "thumbs")
        Directory.CreateDirectory(thumbDir)
        let target = Path.Combine(thumbDir, SanitizeFileName(fileId) + ".png")

        if File.Exists(target) {
            return target
        }

        if shouldCancel != nil && shouldCancel() {
            return ""
        }

        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return ""
        }

        try {
            using let request = CreateAuthorizedRequest(HttpMethod.Get, meta.ThumbnailLink, config)
            using let response = _http.Send(request)

            if !response.IsSuccessStatusCode {
                return ""
            }

            let bytes = response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()

            if bytes.Length > 0 {
                File.WriteAllBytes(target, bytes)
                return target
            }
        } catch { }

        return ""
    }

    internal func OpenItem(cloudPath string, name string) string {
        let fileId = Locations.CloudId(cloudPath)
        let meta = GetCachedMeta(fileId)

        if meta != nil && meta.IsGoogleDoc() && !string.IsNullOrWhiteSpace(meta.WebViewLink) {
            LaunchUri(meta.WebViewLink)
            return ""
        }

        var localPath = ""
        let err = DownloadForPreview(cloudPath, name, nil, out localPath)

        if err != "" {
            return err
        }

        LaunchUri(localPath)
        return ""
    }

    private func PrepareConfig(out error string) GoogleDriveConfig {
        error = ""
        let working = ConfigSnapshot()

        if !working.IsConfigured() {
            error = "Google Drive is not connected. Open Preferences -> Cloud to sign in or add an API key."
            return working
        }

        if working.IsSignedIn() {
            let tokenErr = _auth.EnsureValidToken(_http, working, _store)

            if tokenErr != "" {
                error = tokenErr
                return working
            }

            lock _sync {
                _config = working
            }
        }

        return working
    }

    private func CreateAuthorizedRequest(method HttpMethod, url string, config GoogleDriveConfig) HttpRequestMessage {
        let finalUrl = config.IsSignedIn() ? url: AppendApiKey(url, config)
        let request = HttpRequestMessage(method, finalUrl)

        if !string.IsNullOrWhiteSpace(config.AccessToken) {
            request.Headers.Authorization = AuthenticationHeaderValue("Bearer", config.AccessToken)
        }

        return request
    }

    private func AppendApiKey(url string, config GoogleDriveConfig) string {
        if string.IsNullOrWhiteSpace(config.ApiKey) || url.Contains("key=") {
            return url
        }

        let sep = url.Contains("?") ? "&": "?"
        return url + sep + "key=" + Uri.EscapeDataString(config.ApiKey)
    }

    private func BuildDownloadUrl(fileId string, meta DriveItemMeta?) string {
        let baseUrl = GoogleDriveAuthService.ApiBaseUrl() + "/files/" + Uri.EscapeDataString(fileId)

        if meta != nil && meta.IsGoogleDoc() {
            let exportMime = ExportMimeFor(meta.MimeType)
            return baseUrl + "/export?mimeType=" + Uri.EscapeDataString(exportMime)
        }

        return baseUrl + "?alt=media"
    }

    private func ExportMimeFor(googleMime string) string {
        if googleMime == "application/vnd.google-apps.spreadsheet" {
            return "text/csv"
        }

        if googleMime == "application/vnd.google-apps.presentation" {
            return "application/pdf"
        }

        return "text/plain"
    }

    private func ResolveExportLocalPath(localPath string, meta DriveItemMeta?) string {
        if meta == nil || !meta.IsGoogleDoc() {
            return localPath
        }

        let ext = meta.MimeType == "application/vnd.google-apps.spreadsheet" ? ".csv":
        meta.MimeType == "application/vnd.google-apps.presentation" ? ".pdf": ".txt"
        return localPath.EndsWith(ext, StringComparison.OrdinalIgnoreCase) ? localPath: localPath + ext
    }

    private func EnsureMeta(fileId string, config GoogleDriveConfig) DriveItemMeta? {
        let cached = GetCachedMeta(fileId)

        if cached != nil {
            return cached
        }

        let url = GoogleDriveAuthService.ApiBaseUrl() + "/files/" + Uri.EscapeDataString(fileId) +
            "?fields=id,name,mimeType,size,createdTime,modifiedTime,parents,capabilities(canRename,canTrash),thumbnailLink,webViewLink"
        using let request = CreateAuthorizedRequest(HttpMethod.Get, url, config)
        using let response = _http.Send(request)

        if !response.IsSuccessStatusCode {
            return nil
        }

        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        using let doc = JsonDocument.Parse(body)
        let meta = ParseDriveMeta(doc.RootElement, "")
        CacheMeta(meta)
        return meta
    }

    private func ParseDriveMeta(item JsonElement, fallbackParent string) DriveItemMeta {
        let id = ReadString(item, "id", "")
        let name = ReadString(item, "name", id)
        let mimeType = ReadString(item, "mimeType", "application/octet-stream")
        let size = ParseInt64(item, "size")
        let created = ParseDateTime(ReadString(item, "createdTime", ""))
        let modified = ParseDateTime(ReadString(item, "modifiedTime", ""))
        let isFolder = mimeType == "application/vnd.google-apps.folder"
        let isShortcut = mimeType == "application/vnd.google-apps.shortcut"
        var parentId = fallbackParent
        var parents JsonElement

        if item.TryGetProperty("parents", out parents) && parents.ValueKind == JsonValueKind.Array {
            for p in parents.EnumerateArray() {
                if p.ValueKind == JsonValueKind.String {
                    parentId = p.GetString() ?? fallbackParent
                    break
                }
            }
        }

        var targetId = ""
        var targetMime = ""
        var shortcut JsonElement

        if item.TryGetProperty("shortcutDetails", out shortcut) && shortcut.ValueKind == JsonValueKind.Object {
            targetId = ReadString(shortcut, "targetId", "")
            targetMime = ReadString(shortcut, "targetMimeType", "")
        }

        var canRename = true
        var canTrash = true
        var caps JsonElement

        if item.TryGetProperty("capabilities", out caps) && caps.ValueKind == JsonValueKind.Object {
            canRename = ReadBool(caps, "canRename", true)
            canTrash = ReadBool(caps, "canTrash", true)
        }

        let thumbLink = ReadString(item, "thumbnailLink", "")
        let webView = ReadString(item, "webViewLink", "")

        return DriveItemMeta(
            id,
            name,
            mimeType,
            parentId,
            size,
            created,
            modified,
            isFolder,
            isShortcut,
            targetId,
            targetMime,
            canRename,
            canTrash,
            thumbLink,
            webView
        )
    }

    private func ToFileEntry(meta DriveItemMeta) FileEntry {
        let targetIsFolder = meta.IsFolder ||
            (meta.IsShortcut && meta.ShortcutTargetMimeType == "application/vnd.google-apps.folder")
        let navId = meta.IsShortcut && meta.ShortcutTargetId != "" ? meta.ShortcutTargetId: meta.Id
        let entryPath = Locations.CloudPath(navId)
        let kind = FileKinds.EntryKind(Path.GetExtension(meta.Name).ToLowerInvariant(), targetIsFolder, meta.IsShortcut)
        let perms = (meta.CanRename ? "rw": "r") + (meta.CanTrash ? "d": "-")

        return FileEntry{
            Name: meta.Name,
            FullPath: entryPath,
            IsDirectory: targetIsFolder,
            IsSymlink: meta.IsShortcut,
            Size: meta.Size,
            Modified: meta.Modified,
            Created: meta.Created,
            Kind: kind,
            Permissions: perms,
        }
    }

    private func CacheMeta(meta DriveItemMeta) {
        lock _sync {
            _metaCache[meta.Id] = meta
        }
    }

    private func BuildMetadataJson(name string, mimeType string, parentId string) string {
        using let stream = MemoryStream()
        using let writer = Utf8JsonWriter(stream)
        writer.WriteStartObject()

        if !string.IsNullOrWhiteSpace(name) {
            writer.WriteString("name", name)
        }

        if !string.IsNullOrWhiteSpace(mimeType) {
            writer.WriteString("mimeType", mimeType)
        }

        if !string.IsNullOrWhiteSpace(parentId) {
            writer.WriteStartArray("parents")
            writer.WriteStringValue(parentId)
            writer.WriteEndArray()
        }

        writer.WriteEndObject()
        writer.Flush()
        return Encoding.UTF8.GetString(stream.ToArray())
    }

    private func EscapeQuery(value string) string -> value.Replace("\\", "\\\\").Replace("'", "\\'")

    private func SanitizeFileName(value string) string {
        var result = value

        for ch in Path.GetInvalidFileNameChars() {
            result = result.Replace(ch, '_')
        }

        return result == "" ? "item": result
    }

    private func LaunchUri(target string) {
        try {
            let psi = ProcessStartInfo("xdg-open", target)
            psi.UseShellExecute = false
            psi.CreateNoWindow = true
            Process.Start(psi)
        } catch { }
    }

    private func ReadString(obj JsonElement, key string, fallback string) string {
        var val JsonElement

        if obj.TryGetProperty(key, out val) && val.ValueKind == JsonValueKind.String {
            return val.GetString() ?? fallback
        }

        return fallback
    }

    private func ReadBool(obj JsonElement, key string, fallback bool) bool {
        var val JsonElement

        if obj.TryGetProperty(key, out val) {
            if val.ValueKind == JsonValueKind.True {
                return true
            }

            if val.ValueKind == JsonValueKind.False {
                return false
            }
        }

        return fallback
    }

    private func ParseInt64(obj JsonElement, key string) int64 {
        var val JsonElement

        if obj.TryGetProperty(key, out val) {
            if val.ValueKind == JsonValueKind.Number {
                var num = int64(0)
                return val.TryGetInt64(out num) ? num: int64(0)
            }

            if val.ValueKind == JsonValueKind.String {
                var num = int64(0)
                return int64.TryParse(val.GetString() ?? "", out num) ? num: int64(0)
            }
        }

        return int64(0)
    }

    private func ParseDateTime(raw string) DateTime {
        var dt DateTime

        if DateTime.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out dt
        ) {
            return dt.ToLocalTime()
        }

        return DateTime.UtcNow.ToLocalTime()
    }
}
