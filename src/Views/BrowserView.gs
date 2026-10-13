package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView : Cell {
    private let settings AppSettings
    private let settingsService SettingsService
    private let launch LaunchOptions
    private var palette Palette
    private var keyboardFocus bool
    private var window Window?
    private var browser BrowserController?
    private var thumbnails ThumbnailService?
    private var folderCounts FolderCountService?
    private var settingsWriter SettingsWriter?
    private let rootHandle ElementHandle = ElementHandle()
    private let paneViews List[BrowserPaneViewState] = List[BrowserPaneViewState]()
    private let locationHandle ElementHandle = ElementHandle()
    private let filterHandle ElementHandle = ElementHandle()
    private let dialogHandle ElementHandle = ElementHandle()
    private let dialogInput ElementHandle = ElementHandle()
    private let smoothScrollingRow ElementHandle = ElementHandle()
    private let previewWordWrapRow ElementHandle = ElementHandle()
    private let previewLineNumbersRow ElementHandle = ElementHandle()
    private let scrollSpeedRow ElementHandle = ElementHandle()
    private let themeEditorHandle ElementHandle = ElementHandle()
    private var focusScope FocusScope?
    private const WindowRadius float64 = 12
    internal const DefaultWidth int32 = 1180
    internal const DefaultHeight int32 = 760
    private const SplitBreakpoint float64 = 660
    private const PlacesBreakpoint float64 = 860
    private const PaneMinimum float64 = 260
    private const VerticalPaneMinimum float64 = 120
    private const WorkspaceMinimum float64 = 560
    private var width float64 = DefaultWidth
    private var height float64 = DefaultHeight
    private var placesWidth float64 = 180
    private var paneRatio float64 = .5
    private var previewRatio float64 = .5
    private var splitPreviewRatio float64 = .67
    private var dropPath string = ""
    private var locationEditing bool
    private var locationFocusPending bool
    private var locationText string = ""
    private var dialog string = ""
    private var dialogValue string = ""
    private var dialogError string = ""
    private var notice string
    private let preferenceInputs Dictionary[string, string] = Dictionary[string, string]()
    private var preferenceTab string = "Shortcuts"
    private var themeColorRole string = "Background"
    private var revealThemeEditor bool
    private let preferenceHandles Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    internal init(settings AppSettings, service SettingsService, launch LaunchOptions, warning string) {
        this.settings = settings
        settingsService = service
        this.launch = launch
        palette = Palette(settings.Theme)
        notice = warning
        rootHandle.MetricsChanged += (metrics) -> {
            if metrics.IsMounted &&
                (Math.Abs(width - metrics.ContentBox.Width) > 1 || Math.Abs(height - metrics.ContentBox.Height) > 1) {
                width = metrics.ContentBox.Width
                height = metrics.ContentBox.Height
                if locationEditing && dialog == "" && PaneWidth(Model.ActiveIndex) < 360 {
                    OpenDialog("Open location", locationText)
                } else {
                    Rebuild()
                }
            }
        }
        dialogHandle.MetricsChanged += (metrics) -> {
            if metrics.IsMounted && focusScope == nil {
                let textEntry = dialog != "Preferences" &&
                    dialog != "Desktop setup" &&
                    dialog != "Move to Trash" &&
                    dialog != "Delete permanently" &&
                    dialog != "Empty Trash" &&
                    dialog != "Bookmarks" &&
                    dialog != "Properties" &&
                    dialog != "Replace file"
                focusScope = dialogHandle.BeginFocusScope(
                    FocusScopeOptions{
                        Modal: true,
                        InitialFocus: if textEntry {
                            dialogInput
                        } else if dialog == "Desktop setup" {
                            setupChoiceHandle
                        } else {
                            dialogHandle
                        },
                    }
                )
                if textEntry {
                    dialogInput.Focus()
                    if dialog == "Rename" || dialog == "Filter files" || dialog == "Open location" {
                        Host.PlatformInput.Execute(TextCommand{Kind: TextCommandKind.SelectAll})
                    }
                }
            }
        }
        themeEditorHandle.MetricsChanged += (metrics) -> {
            if metrics.IsMounted && revealThemeEditor {
                revealThemeEditor = false
                themeEditorHandle.ScrollIntoView()
            }
        }
        locationHandle.MetricsChanged += (metrics) -> {
            if metrics.IsMounted && locationFocusPending {
                locationFocusPending = false
                locationHandle.Focus()
                Host.PlatformInput.Execute(TextCommand{Kind: TextCommandKind.SelectAll})
            }
        }
    }

    internal func Attach(value Window) {
        window = value
        value.FocusChanged += DismissContextMenuOnBlur
        value.MetricsChanged += WindowResized
        value.StateChanged += WindowStateChanged
        value.KeyPressed += KeyPressed
        ApplyBackdrop()
        value.WheelScrollScale = float32(settings.ScrollSpeed)
        value.SmoothScrolling = settings.SmoothScrolling
        browser = BrowserController(
            value,
            settings,
            () -> Changed(),
            () -> ResetTypeSelect(),
            Math.Max(1, value.Width),
            Math.Max(1, value.Height)
        )
        SyncPaneViews()
        value.MetricsChanged += PreviewWindowMetrics
        thumbnails = ThumbnailService(value)
        selectionInfo = SelectionInfoService(value)
        folderCounts = FolderCountService(value, () -> Rebuild())
        value.FocusChanged += RefreshPlacesOnFocus
        Model.Places.Refresh()
        if launch.ChooserRequest == nil {
            settingsWriter = SettingsWriter(
                value,
                settingsService,
                error -> {
                    notice = error
                    if dialog == "Preferences" {
                        dialogError = error
                    }
                    Rebuild()
                }
            )
        }
        if let request = launch.ChooserRequest {
            let picker = AttachChooser(request)
            Model.Start(picker.InitialDirectory, picker.InitialSelectedPath)
        } else {
            Model.Start(launch.DirectoryPath, launch.SelectedPath)
            if launch.Setup || FirstRunSetup.ShouldOffer() {
                OpenSetup()
            }
        }
    }

    internal func Shutdown() {
        if let attached = window {
            attached.FocusChanged -= DismissContextMenuOnBlur
            attached.MetricsChanged -= WindowResized
            attached.MetricsChanged -= PreviewWindowMetrics
            attached.StateChanged -= WindowStateChanged
            attached.KeyPressed -= KeyPressed
            attached.FocusChanged -= RefreshPlacesOnFocus
        }
        if let done = setupCompletion {
            <-done
        }
        CommitPreferenceBindings()
        previewResizeTimer?.Dispose()
        previewResizeTimer = nil
        settingsWriter?.Dispose()
        browser?.Dispose()
        thumbnails?.Dispose()
        folderCounts?.Dispose()
        selectionInfo?.Dispose()
    }

    internal func CloseSafely() bool -> !setupBusy && Model.Operations.CloseSafely()

    private func PaneFocus(index int32) ElementHandle -> settings.ViewMode == "tiles" ?
    paneViews[index].TileFocus: paneViews[index].ListFocus

    private func PaneViewport(index int32) ElementHandle -> settings.ViewMode == "tiles" ?
    paneViews[index].TileViewport: paneViews[index].ListViewport

    private func SyncPaneViews() {
        var stateIndex = paneViews.Count - 1
        while stateIndex >= 0 {
            if !Model.Panes.Contains(paneViews[stateIndex].Pane) {
                paneViews.RemoveAt(stateIndex)
            }
            stateIndex--
        }
        for index in paneViews.Count ... Model.Panes.Count {
            let state = BrowserPaneViewState(Model.Pane(index))
            paneViews.Add(state)
            WatchList(state.ListViewport, state)
            WatchList(state.TileViewport, state)
        }
    }

    private prop Model BrowserController {
        get {
            guard let value = browser else {
                throw InvalidOperationException("Browser is not attached")
            }
            return value
        }
    }

    private prop Host Window {
        get {
            guard let value = window else {
                throw InvalidOperationException("Window is not attached")
            }
            return value
        }
    }

    private prop Thumbnails ThumbnailService {
        get {
            guard let value = thumbnails else {
                throw InvalidOperationException("Thumbnails are not attached")
            }
            return value
        }
    }

    private prop FolderCounts FolderCountService {
        get {
            guard let value = folderCounts else {
                throw InvalidOperationException("Folder counts are not attached")
            }
            return value
        }
    }

    private func Changed() {
        SyncPaneViews()
        if window != nil {
            PreviewChanged()
            if Model.Operations.ReadyToClose {
                Host.RequestClose()
            }
            Host.Title = ChooserTitle()
        }
        if let picker = chooser {
            let pane = Model.ActivePane()
            if !pane.Loading && chooserDirectory != pane.DirectoryPath {
                chooserDirectory = pane.DirectoryPath
                chooserError = ""
                if picker.Request.Directory || picker.SavingMany {
                    Model.ClearSelection()
                }
            }
        }
        Rebuild()
        for state in paneViews {
            let pane = state.Pane
            let selection = pane.DirectoryPath + "\0" + pane.Selected.ToString()
            if state.Selection != selection {
                state.Selection = selection
                if !pane.Refreshing {
                    state.RevealPending = true
                    Host.Post(() -> RevealSelection(state))
                }
            }
        }
    }

    override func Build() Blob {
        if browser == nil {
            return Container{BackgroundColor: palette.Window}
        }
        let p = palette
        let browsing = BrowsingSplit(p)
        let browserArea = PreviewSplit(browsing, p)
        let main = PlacesSplit(browserArea, p)
        let children = List[Blob]()
        let chrome = WindowBar.Build(Host, Toolbar(), width, p)
        chrome.Key = "window-bar"
        children.Add(chrome)
        children.Add(main)
        children.Add(chooser != nil ? ChooserBar(): StatusBar())
        if dialog != "" {
            children.Add(Dialog())
        }
        children.Add(ContextMenu())
        let rounded = Rounded()
        return Container{
            Handle: rootHandle,
            Width: Percent(100),
            Height: Percent(100),
            MinHeight: 0,
            BackgroundColor: p.Window,
            BorderRadius: rounded ? WindowRadius: 0,
            BorderWidth: rounded ? 1: 0,
            BorderColor: p.Edge,
            Overflow: rounded ? Overflow.Hidden: Overflow.Visible,
            Color: p.Text,
            FontFamily: "sans-serif, Noto Sans CJK",
            FontSize: 13,
            OnKeyDown: HandleKey,
            OnPointerDown: (_) -> SetKeyboardFocus(false),
            KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
            Children: children.ToArray(),
        }
    }

    private func BrowsingSplit(p Palette) Blob {
        let first = Pane(0)
        var second Blob? = nil
        if Model.Split {
            second = Pane(1)
        }
        return SplitDivider.Build(
            "browser-split",
            first,
            second,
            if Model.Split {
                paneRatio
            } else {
                1
            },
            value -> {
                paneRatio = value
                Rebuild()
            },
            SplitUnit.Ratio,
            if BrowsingWidth() < SplitBreakpoint {
                SplitOrientation.Vertical
            } else {
                SplitOrientation.Horizontal
            },
            if BrowsingWidth() < SplitBreakpoint {
                VerticalPaneMinimum
            } else {
                PaneMinimum
            },
            if BrowsingWidth() < SplitBreakpoint {
                VerticalPaneMinimum
            } else {
                PaneMinimum
            },
            "Resize browsing panes",
            Model.Split,
            p
        )
    }

    private func PreviewSplit(browsing Blob, p Palette) Blob {
        var preview Blob? = nil
        if Model.PreviewVisible {
            preview = PreviewSidebar.Build(PreviewInput(), Host, p)
        }
        let workspace = SplitDivider.Build(
            "preview-split",
            browsing,
            preview,
            if Model.PreviewVisible {
                if Model.Split {
                    splitPreviewRatio
                } else {
                    previewRatio
                }
            } else {
                1
            },
            value -> {
                if Model.Split {
                    splitPreviewRatio = value
                } else {
                    previewRatio = value
                }
                Rebuild()
            },
            SplitUnit.Ratio,
            SplitOrientation.Horizontal,
            PaneMinimum,
            PreviewSidebar.MinimumWidth,
            "Resize preview",
            Model.PreviewVisible,
            p
        )
        workspace.Key = "workspace"
        let browserArea = Container{
            Key: "browser-area",
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            workspace,
        }
        return browserArea
    }

    private func PlacesSplit(browserArea Blob, p Palette) Blob {
        var bookmarkDrop Func[int32, DropTarget]? = nil
        var bookmarkMenu Action[string, Point]? = nil
        var bookmarkMenuKey Action[string, KeyEvent, Point]? = nil
        if chooser == nil {
            bookmarkDrop = index -> BookmarkDropTarget(index)
            bookmarkMenu = OpenBookmarkContextMenu
            bookmarkMenuKey = OpenBookmarkKeyboardContextMenu
        }
        var places Blob? = nil
        if width >= PlacesBreakpoint {
            places = PlacesSidebar.Build(
                Model.ActivePane().DirectoryPath,
                path -> {
                    Model.Navigate(path)
                    FocusFiles()
                },
                () -> OpenPreferences(),
                settings.Bookmarks,
                chooser == nil ? settings.Keybindings["ToggleBookmark"]: "",
                Host,
                p,
                Model.Places.StandardPlaces,
                destination -> FileDropTarget(destination),
                dropPath,
                chooser == nil,
                bookmarkDrop,
                bookmarkDropIndex,
                bookmarkMenu,
                bookmarkMenuKey,
                Model.Places.Volumes,
                OpenVolume,
                EjectVolume,
                Model.TrashDirectory,
                Model.Places.TrashCount,
                chooser == nil
            )
        }
        let main = SplitDivider.Build(
            "places-split",
            places,
            browserArea,
            if width >= PlacesBreakpoint {
                placesWidth
            } else {
                0
            },
            value -> {
                placesWidth = value
                Rebuild()
            },
            SplitUnit.Pixels,
            SplitOrientation.Horizontal,
            PlacesSidebar.MinimumWidth,
            WorkspaceMinimum,
            "Resize places sidebar",
            width >= PlacesBreakpoint,
            p
        )
        main.Key = "main"
        return main
    }

    private func FolderName(path string) string {
        var directory = path
        while directory.Length > 1 && Path.EndsInDirectorySeparator(directory) {
            directory = Path.TrimEndingDirectorySeparator(directory)
        }
        if directory == "/" {
            return "File system"
        }
        if directory == Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) {
            return "Home"
        }
        return Path.GetFileName(directory)
    }
}
