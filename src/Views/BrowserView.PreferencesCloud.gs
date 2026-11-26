package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System
import System.Collections.Generic

partial class BrowserView {
    private var cloudInputsLoaded bool
    private var cloudSigningIn bool
    private var cloudBusy bool
    private var cloudClientId string = ""
    private var cloudClientSecret string = ""
    private var cloudApiKey string = ""
    private var cloudRootFolderId string = "root"
    private var cloudStatusMessage string = ""
    private var cloudErrorMessage string = ""

    private func EnsureCloudInputs() {
        if cloudInputsLoaded {
            return
        }

        let cfg = Model.GoogleDrive.ConfigSnapshot()
        cloudClientId = cfg.ClientId
        cloudClientSecret = cfg.ClientSecret
        cloudApiKey = cfg.ApiKey
        cloudRootFolderId = cfg.EffectiveRootId()
        cloudInputsLoaded = true
    }

    private func CloudRows(rows List[Blob], p Palette) {
        EnsureCloudInputs()
        let cfg = Model.GoogleDrive.ConfigSnapshot()
        rows.Add(CloudStatusCard(cfg, p))
        rows.Add(CloudOAuthCard(p))
        rows.Add(CloudApiKeyCard(p))
    }

    private func CloudStatusCard(cfg GoogleDriveConfig, p Palette) Blob {
        let content = List[Blob]()
        let connected = cfg.IsSignedIn()
        let hasKey = !string.IsNullOrWhiteSpace(cfg.ApiKey)
        let iconName = connected || hasKey ? "cloud_done": "cloud"
        let iconColor = connected ? p.Accent: p.Muted
        let titleText = if connected {
            !string.IsNullOrWhiteSpace(cfg.AccountName) ? cfg.AccountName: "Connected to Google Drive"
        } else if hasKey {
            "API Key Configured"
        } else {
            "Not Connected"
        }

        let detailText = if connected {
            let emailPart = !string.IsNullOrWhiteSpace(cfg.AccountEmail) ? cfg.AccountEmail: "OAuth 2.0 session active"

            if cfg.StorageLimit > 0 {
                emailPart + "  •  " + FileSystemService.FormatSize(cfg.StorageUsed) +
                    " of " +
                    FileSystemService.FormatSize(cfg.StorageLimit) + " used"
            } else {
                emailPart
            }
        } else if hasKey {
            "Read/browse public or shared items using your Google Drive API key."
        } else {
            "Sign in with OAuth 2.0 for your private My Drive, or enter an API key below."
        }

        content.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 10,
                Ui.Icon(iconName, iconColor, 20),
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    Gap: 2,
                    Ui.Label(titleText, p.Text, 13, 600),
                    Text{Content: detailText, Color: p.Muted, FontSize: 12, TextWrap: TextWrap.Wrap},
                },
            }
        )

        let actions = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Padding: Edges{Top: 4},
        }

        if connected || hasKey {
            actions.Children.Add(
                DialogButton(
                    "Open Drive",
                    () -> {
                        CloseDialog()
                        Model.Navigate(Locations.GoogleDriveRoot)
                        FocusFiles()
                    },
                    p,
                    true
                )
            )
        }

        if connected {
            actions.Children.Add(DialogButton(cloudBusy ? "Refreshing...": "Refresh", () -> RefreshCloudAccount(), p))
            actions.Children.Add(
                DialogButton(
                    "Disconnect",
                    () -> {
                        let err = Model.GoogleDrive.Disconnect()
                        cloudStatusMessage = err == "" ? "Signed out of Google Drive.": ""
                        cloudErrorMessage = err
                        Rebuild()
                    },
                    p
                )
            )
        }

        if actions.Children.Count > 0 {
            content.Add(actions)
        }

        if cloudErrorMessage != "" {
            content.Add(Text{Content: cloudErrorMessage, Color: p.Danger, FontSize: 12, TextWrap: TextWrap.Wrap})
        } else if cloudStatusMessage != "" {
            content.Add(Text{Content: cloudStatusMessage, Color: p.Accent, FontSize: 12, TextWrap: TextWrap.Wrap})
        }

        return Ui.SectionCard(
            "Google Drive",
            "Connect your private Google Drive account or browse shared folders with an API key.",
            content.ToArray(),
            p
        )
    }

    private func CloudOAuthCard(p Palette) Blob {
        let content = List[Blob]()

        content.Add(
            PreferenceRow.Build(
                "Client ID",
                TextField.Build(
                    cloudClientId,
                    value -> {
                        cloudClientId = value
                        Rebuild()
                    },
                    _ -> SaveCloudSettings(false),
                    "1234567890-abc.apps.googleusercontent.com",
                    p,
                    fontSize: 12
                ),
                p,
                stacked: true
            )
        )

        content.Add(
            PreferenceRow.Build(
                "Client Secret (optional)",
                TextField.Build(
                    cloudClientSecret,
                    value -> {
                        cloudClientSecret = value
                        Rebuild()
                    },
                    _ -> SaveCloudSettings(false),
                    "Optional client secret",
                    p,
                    fontSize: 12
                ),
                p,
                stacked: true
            )
        )

        let buttons = Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 8,
            Padding: Edges{Top: 4},
            DialogButton("Import Clipboard JSON", () -> ImportOAuthJsonFromClipboard(), p),
            if cloudSigningIn {
                DialogButton(
                    "Cancel Sign-In",
                    () -> {
                        Model.GoogleDrive.CancelSignIn()
                        cloudSigningIn = false
                        cloudStatusMessage = "Sign-in cancelled."
                        Rebuild()
                    },
                    p
                )
            } else {
                DialogButton("Sign in with Google", () -> StartCloudSignIn(), p, true)
            },
        }
        content.Add(buttons)

        return Ui.SectionCard(
            "OAuth 2.0 Sign-In (Private Drive)",
            "Uses PKCE loopback redirect on localhost. Credentials are stored locally with 0600 permissions.",
            content.ToArray(),
            p
        )
    }

    private func CloudApiKeyCard(p Palette) Blob {
        let content = List[Blob]()

        content.Add(
            PreferenceRow.Build(
                "API Key (optional)",
                TextField.Build(
                    cloudApiKey,
                    value -> {
                        cloudApiKey = value
                        Rebuild()
                    },
                    _ -> SaveCloudSettings(true),
                    "AIza...",
                    p,
                    fontSize: 12
                ),
                p,
                stacked: true
            )
        )

        content.Add(
            PreferenceRow.Build(
                "Root Folder ID",
                TextField.Build(
                    cloudRootFolderId,
                    value -> {
                        cloudRootFolderId = value
                        Rebuild()
                    },
                    _ -> SaveCloudSettings(true),
                    "root",
                    p,
                    fontSize: 12
                ),
                p,
                stacked: true
            )
        )

        content.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Padding: Edges{Top: 4},
                DialogButton("Save", () -> SaveCloudSettings(true), p),
                DialogButton(cloudBusy ? "Testing...": "Test API Key", () -> TestCloudApiKey(), p),
            }
        )

        return Ui.SectionCard(
            "API Key & Scope",
            "Configure an optional Google Drive API key and starting folder.",
            content.ToArray(),
            p
        )
    }

    private func SaveCloudSettings(showStatus bool) {
        let err = Model.GoogleDrive.UpdateSettings(cloudClientId, cloudClientSecret, cloudApiKey, cloudRootFolderId)
        cloudErrorMessage = err

        if err == "" && showStatus {
            cloudStatusMessage = "Saved Google Drive settings."
        }

        Rebuild()
    }

    private func ImportOAuthJsonFromClipboard() {
        let clip = Host.Clipboard.ReadText()
        let raw = clip.Status == ClipboardReadStatus.Success ? clip.Text: ""
        let parsed = CloudAccountHelpers.ParseOAuthClientJson(raw)

        if parsed.Error != "" {
            cloudErrorMessage = parsed.Error
            cloudStatusMessage = ""
            Rebuild()
            return
        }

        cloudClientId = parsed.ClientId
        cloudClientSecret = parsed.ClientSecret
        cloudErrorMessage = Model.GoogleDrive.UpdateSettings(
            cloudClientId,
            cloudClientSecret,
            cloudApiKey,
            cloudRootFolderId
        )

        if cloudErrorMessage == "" {
            cloudStatusMessage = "Imported OAuth client credentials from clipboard."
        }

        Rebuild()
    }

    private func StartCloudSignIn() {
        if cloudSigningIn {
            return
        }

        cloudSigningIn = true
        cloudErrorMessage = ""
        cloudStatusMessage = "Waiting for browser authorization..."
        Rebuild()

        let window = Host
        let drive = Model.GoogleDrive
        let cid = cloudClientId
        let secret = cloudClientSecret
        let key = cloudApiKey
        let rootId = cloudRootFolderId

        go cloudSignInWorker(window, this, drive, cid, secret, key, rootId)
    }

    internal func CompleteCloudSignIn(error string) {
        cloudSigningIn = false
        cloudErrorMessage = error
        cloudStatusMessage = error == "" ? "Connected to Google Drive.": ""
        Rebuild()
    }

    private func RefreshCloudAccount() {
        if cloudBusy {
            return
        }

        cloudBusy = true
        cloudErrorMessage = ""
        Rebuild()

        let window = Host
        let drive = Model.GoogleDrive

        go cloudRefreshWorker(window, this, drive)
    }

    internal func CompleteCloudRefresh(error string) {
        cloudBusy = false
        cloudErrorMessage = error
        cloudStatusMessage = error == "" ? "Account status refreshed.": ""
        Rebuild()
    }

    private func TestCloudApiKey() {
        if cloudBusy {
            return
        }

        cloudBusy = true
        cloudErrorMessage = ""
        cloudStatusMessage = "Testing API key..."
        Rebuild()

        let window = Host
        let drive = Model.GoogleDrive
        let key = cloudApiKey
        let rootId = cloudRootFolderId

        go cloudTestKeyWorker(window, this, drive, key, rootId)
    }

    internal func CompleteCloudTestKey(error string) {
        cloudBusy = false
        cloudErrorMessage = error

        if error == "" {
            Model.GoogleDrive.UpdateSettings(cloudClientId, cloudClientSecret, cloudApiKey, cloudRootFolderId)
            cloudStatusMessage = "API key verified and saved."
        } else {
            cloudStatusMessage = ""
        }

        Rebuild()
    }
}

func cloudSignInWorker(
    window Window,
    view BrowserView,
    drive GoogleDriveService,
    clientId string,
    clientSecret string,
    apiKey string,
    rootId string
) {
    let err = drive.SignIn(clientId, clientSecret, apiKey, rootId)

    try {
        window.Post(() -> view.CompleteCloudSignIn(err))
    } catch (failure InvalidOperationException) { }
}

func cloudRefreshWorker(window Window, view BrowserView, drive GoogleDriveService) {
    let err = drive.RefreshAccountStatus()

    try {
        window.Post(() -> view.CompleteCloudRefresh(err))
    } catch (failure InvalidOperationException) { }
}

func cloudTestKeyWorker(window Window, view BrowserView, drive GoogleDriveService, apiKey string, rootId string) {
    let err = drive.TestApiKey(apiKey, rootId)

    try {
        window.Post(() -> view.CompleteCloudTestKey(err))
    } catch (failure InvalidOperationException) { }
}
