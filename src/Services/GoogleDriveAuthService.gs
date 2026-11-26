package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Net
import System.Net.Http
import System.Net.Http.Headers
import System.Net.Sockets
import System.Security.Cryptography
import System.Text
import System.Text.Json

internal class GoogleDriveAuthService {
    private var _activeListener TcpListener? = nil
    private var _cancelRequested bool = false

    shared {
        internal func ApiBaseUrl() string {
            let env = Environment.GetEnvironmentVariable("GLOOP_GDRIVE_API_BASE")

            if !string.IsNullOrWhiteSpace(env) {
                return env.Trim().TrimEnd('/')
            }

            return "https://www.googleapis.com/drive/v3"
        }

        internal func UploadBaseUrl() string {
            let env = Environment.GetEnvironmentVariable("GLOOP_GDRIVE_UPLOAD_BASE")

            if !string.IsNullOrWhiteSpace(env) {
                return env.Trim().TrimEnd('/')
            }

            let api = ApiBaseUrl()

            if api.Contains("127.0.0.1") || api.Contains("localhost") {
                return api.Replace("/drive/v3", "/upload/drive/v3")
            }

            return "https://www.googleapis.com/upload/drive/v3"
        }

        internal func AuthEndpoint() string {
            let env = Environment.GetEnvironmentVariable("GLOOP_GDRIVE_AUTH_URL")
            return !string.IsNullOrWhiteSpace(env) ? env.Trim(): "https://accounts.google.com/o/oauth2/v2/auth"
        }

        internal func TokenEndpoint() string {
            let env = Environment.GetEnvironmentVariable("GLOOP_GDRIVE_TOKEN_URL")
            return !string.IsNullOrWhiteSpace(env) ? env.Trim(): "https://oauth2.googleapis.com/token"
        }

        internal func ExtractApiError(body string, status HttpStatusCode) string {
            let statusText = "HTTP " + int32(status).ToString()

            if !string.IsNullOrWhiteSpace(body) {
                try {
                    using let doc = JsonDocument.Parse(body)
                    let root = doc.RootElement
                    var err JsonElement
                    var msg JsonElement

                    if root.TryGetProperty("error", out err) {
                        if err.ValueKind == JsonValueKind.Object && err.TryGetProperty("message", out msg) {
                            return msg.GetString() ?? statusText
                        }

                        if err.ValueKind == JsonValueKind.String {
                            if root.TryGetProperty("error_description", out msg) {
                                return (err.GetString() ?? "") + ": " + (msg.GetString() ?? "")
                            }

                            return err.GetString() ?? statusText
                        }
                    }
                } catch { }
            }

            return statusText + " (" + status.ToString() + ")"
        }
    }

    internal func CancelSignIn() {
        _cancelRequested = true
        try {
            _activeListener?.Stop()
        } catch { }
    }

    internal func SignIn(http HttpClient, config GoogleDriveConfig, store CloudCredentialStore) string {
        if string.IsNullOrWhiteSpace(config.ClientId) {
            return "Enter an OAuth Client ID before signing in."
        }

        _cancelRequested = false
        let verifier = GenerateCodeVerifier()
        let challenge = GenerateCodeChallenge(verifier)
        let state = GenerateState()
        let listener = TcpListener(IPAddress.Loopback, 0)

        try {
            listener.Start()
            _activeListener = listener
            let endpoint = listener.LocalEndpoint as IPEndPoint

            if endpoint == nil {
                return "Could not determine local loopback port."
            }

            let redirectUri = "http://127.0.0.1:" + endpoint.Port.ToString() + "/"
            let authUrl = BuildAuthUrl(config.ClientId.Trim(), redirectUri, challenge, state)

            if !LaunchBrowser(authUrl) {
                return "Could not open browser for Google sign-in."
            }

            let code = WaitForAuthCode(listener, state)

            if _cancelRequested {
                return "Sign-in cancelled."
            }

            if string.IsNullOrWhiteSpace(code) {
                return "Sign-in did not receive an authorization code."
            }

            let tokenError = ExchangeCodeForTokens(http, config, code, verifier, redirectUri)

            if tokenError != "" {
                return tokenError
            }

            let aboutError = FetchAbout(http, config)

            if aboutError != "" {
                return aboutError
            }

            return store.Save(config)
        } catch (ex Exception) {
            if _cancelRequested {
                return "Sign-in cancelled."
            }

            return "Google sign-in failed: " + ex.Message
        } finally {
            _activeListener = nil

            try {
                listener.Stop()
            } catch { }
        }
    }

    internal func EnsureValidToken(http HttpClient, config GoogleDriveConfig, store CloudCredentialStore) string {
        if !config.IsSignedIn() {
            return ""
        }

        let now = DateTimeOffset.UtcNow.ToUnixTimeSeconds()

        if !string.IsNullOrWhiteSpace(config.AccessToken) && config.AccessTokenExpiresAtUnix > now + 60 {
            return ""
        }

        if string.IsNullOrWhiteSpace(config.RefreshToken) {
            return ""
        }

        let err = RefreshAccessToken(http, config)

        if err != "" {
            return err
        }

        return store.Save(config)
    }

    internal func RefreshAccessToken(http HttpClient, config GoogleDriveConfig) string {
        if string.IsNullOrWhiteSpace(config.RefreshToken) || string.IsNullOrWhiteSpace(config.ClientId) {
            return "Missing refresh token or client ID."
        }

        let fields = Dictionary[string, string]()
        fields["client_id"] = config.ClientId.Trim()

        if !string.IsNullOrWhiteSpace(config.ClientSecret) {
            fields["client_secret"] = config.ClientSecret.Trim()
        }

        fields["refresh_token"] = config.RefreshToken
        fields["grant_type"] = "refresh_token"
        return PostTokenForm(http, config, fields)
    }

    internal func FetchAbout(http HttpClient, config GoogleDriveConfig) string {
        let url = ApiBaseUrl() + "/about?fields=user(displayName,emailAddress),storageQuota(limit,usage)"
        using let request = HttpRequestMessage(HttpMethod.Get, url)

        if !string.IsNullOrWhiteSpace(config.AccessToken) {
            request.Headers.Authorization = AuthenticationHeaderValue("Bearer", config.AccessToken)
        }

        using let response = http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "Could not read Google Drive account: " + ExtractApiError(body, response.StatusCode)
        }

        using let doc = JsonDocument.Parse(body)
        let root = doc.RootElement
        var user JsonElement

        if root.TryGetProperty("user", out user) && user.ValueKind == JsonValueKind.Object {
            config.AccountName = ReadJsonString(user, "displayName")
            config.AccountEmail = ReadJsonString(user, "emailAddress")
        }

        var quota JsonElement

        if root.TryGetProperty("storageQuota", out quota) && quota.ValueKind == JsonValueKind.Object {
            config.StorageUsed = ParseInt64String(ReadJsonString(quota, "usage"))
            config.StorageLimit = ParseInt64String(ReadJsonString(quota, "limit"))
        }

        return ""
    }

    internal func TestApiKey(http HttpClient, apiKey string, rootId string) string {
        if string.IsNullOrWhiteSpace(apiKey) {
            return "Enter an API key first."
        }

        let effectiveRoot = string.IsNullOrWhiteSpace(rootId) ? "root": rootId.Trim()
        let url = ApiBaseUrl() + "/files/" + Uri.EscapeDataString(effectiveRoot) +
            "?fields=id,name,mimeType&key=" +
            Uri.EscapeDataString(apiKey.Trim())
        using let request = HttpRequestMessage(HttpMethod.Get, url)
        using let response = http.Send(request)
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "API key check failed: " + ExtractApiError(body, response.StatusCode)
        }

        return ""
    }

    private func ExchangeCodeForTokens(
        http HttpClient,
        config GoogleDriveConfig,
        code string,
        verifier string,
        redirectUri string
    ) string {
        let fields = Dictionary[string, string]()
        fields["code"] = code
        fields["client_id"] = config.ClientId.Trim()

        if !string.IsNullOrWhiteSpace(config.ClientSecret) {
            fields["client_secret"] = config.ClientSecret.Trim()
        }

        fields["redirect_uri"] = redirectUri
        fields["grant_type"] = "authorization_code"
        fields["code_verifier"] = verifier
        return PostTokenForm(http, config, fields)
    }

    private func PostTokenForm(http HttpClient, config GoogleDriveConfig, fields Dictionary[string, string]) string {
        using let content = FormUrlEncodedContent(fields)
        using let response = http.PostAsync(TokenEndpoint(), content).GetAwaiter().GetResult()
        let body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

        if !response.IsSuccessStatusCode {
            return "OAuth token error: " + ExtractApiError(body, response.StatusCode)
        }

        using let doc = JsonDocument.Parse(body)
        let root = doc.RootElement
        let accessToken = ReadJsonString(root, "access_token")

        if string.IsNullOrWhiteSpace(accessToken) {
            return "OAuth token response did not include access_token."
        }

        config.AccessToken = accessToken
        let refresh = ReadJsonString(root, "refresh_token")

        if !string.IsNullOrWhiteSpace(refresh) {
            config.RefreshToken = refresh
        }

        var expiresIn = int64(3600)
        var expElem JsonElement

        if root.TryGetProperty("expires_in", out expElem) && expElem.ValueKind == JsonValueKind.Number {
            var parsed = int64(3600)

            if expElem.TryGetInt64(out parsed) {
                expiresIn = parsed
            }
        }

        config.AccessTokenExpiresAtUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + expiresIn
        return ""
    }

    private func WaitForAuthCode(listener TcpListener, expectedState string) string {
        using let client = listener.AcceptTcpClient()
        using let stream = client.GetStream()
        using let reader = StreamReader(stream, Encoding.UTF8, false, 4096, true)
        let firstLine = reader.ReadLine() ?? ""

        if firstLine == "" {
            return ""
        }

        while let headerLine = reader.ReadLine() {
            if headerLine == "" {
                break
            }
        }

        let parts = firstLine.Split(' ')

        if parts.Length < 2 {
            WriteCallbackHtml(stream, false, "Malformed OAuth callback request.")
            return ""
        }

        let target = parts[1]
        let queryStart = target.IndexOf('?')
        let query = queryStart >= 0 ? target.Substring(queryStart + 1): ""
        let parameters = ParseQueryString(query)
        var err = ""

        if parameters.TryGetValue("error", out err) && !string.IsNullOrWhiteSpace(err) {
            WriteCallbackHtml(stream, false, "Google sign-in returned: " + err)
            return ""
        }

        var state = ""

        if !parameters.TryGetValue("state", out state) || state != expectedState {
            WriteCallbackHtml(stream, false, "OAuth state verification failed.")
            return ""
        }

        var code = ""

        if !parameters.TryGetValue("code", out code) || string.IsNullOrWhiteSpace(code) {
            WriteCallbackHtml(stream, false, "No authorization code was received.")
            return ""
        }

        WriteCallbackHtml(stream, true, "Signed in to Google Drive. You can close this tab and return to gloop.")
        return code
    }

    private func WriteCallbackHtml(stream NetworkStream, ok bool, message string) {
        let title = ok ? "Connected to Google Drive": "Google Drive Sign-In Failed"
        let html = "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;background:#16191f;color:#eef2f7\"><h2>" +
            title +
            "</h2><p>" +
            WebUtility.HtmlEncode(message) + "</p></body></html>"
        let header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: " +
            Encoding
            .UTF8
            .GetByteCount(html)
            .ToString() +
            "\r\nConnection: close\r\n\r\n"
        using let writer = StreamWriter(stream, Encoding.UTF8, 4096, true)
        writer.Write(header)
        writer.Write(html)
        writer.Flush()
    }

    private func BuildAuthUrl(
        clientId string,
        redirectUri string,
        challenge string,
        state string
    ) string -> AuthEndpoint() +
        "?client_id=" +
        Uri.EscapeDataString(clientId) + "&redirect_uri=" + Uri.EscapeDataString(redirectUri) +
        "&response_type=code" +
        "&scope=" +
        Uri.EscapeDataString("https://www.googleapis.com/auth/drive") + "&code_challenge=" + Uri.EscapeDataString(
        challenge
    ) +
        "&code_challenge_method=S256" +
        "&access_type=offline" +
        "&prompt=consent" +
        "&state=" +
        Uri.EscapeDataString(state)

    private func LaunchBrowser(url string) bool {
        try {
            let psi = ProcessStartInfo("xdg-open", url)
            psi.UseShellExecute = false
            psi.CreateNoWindow = true
            Process.Start(psi)
            return true
        } catch {
            return false
        }
    }

    private func ParseQueryString(query string) Dictionary[string, string] {
        let result = Dictionary[string, string](StringComparer.Ordinal)

        for pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries) {
            let eq = pair.IndexOf('=')

            if eq <= 0 {
                continue
            }

            let key = Uri.UnescapeDataString(pair.Substring(0, eq).Replace('+', ' '))
            let value = Uri.UnescapeDataString(pair.Substring(eq + 1).Replace('+', ' '))
            result[key] = value
        }

        return result
    }

    private func GenerateCodeVerifier() string {
        let bytes = RandomNumberGenerator.GetBytes(32)
        return Base64Url(bytes)
    }

    private func GenerateCodeChallenge(verifier string) string {
        let hash = SHA256.HashData(Encoding.UTF8.GetBytes(verifier))
        return Base64Url(hash)
    }

    private func GenerateState() string {
        let bytes = RandomNumberGenerator.GetBytes(16)
        return Base64Url(bytes)
    }

    private func Base64Url(bytes[]uint8) string -> Convert
        .ToBase64String(bytes)
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_')

    private func ReadJsonString(element JsonElement, key string) string {
        var value JsonElement

        if element.TryGetProperty(key, out value) && value.ValueKind == JsonValueKind.String {
            return value.GetString() ?? ""
        }

        return ""
    }

    private func ParseInt64String(raw string) int64 {
        var parsed = int64(0)

        if int64.TryParse(raw, out parsed) {
            return parsed
        }

        return int64(0)
    }
}
