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
    private var window Window?
    private var browser BrowserController?
    private var thumbnails ThumbnailService?
    private var settingsWriter SettingsWriter?
    private let rootHandle ElementHandle = ElementHandle()
    private let listFocus[]ElementHandle = []ElementHandle{ElementHandle(), ElementHandle()}
    private let tileFocus[]ElementHandle = []ElementHandle{ElementHandle(), ElementHandle()}
    private let listViewport[]ElementHandle = []ElementHandle{ElementHandle(), ElementHandle()}
    private let tileViewport[]ElementHandle = []ElementHandle{ElementHandle(), ElementHandle()}
    private let selections[]string = []string{"", ""}
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
    private var width float64 = 1180
    private var height float64 = 760
    private var firstWidths Dictionary[string, float64] = Dictionary[string, float64]()
    private var secondWidths Dictionary[string, float64] = Dictionary[string, float64]()
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
        for index in 0 ... 2 {
            WatchList(listViewport[index], index)
            WatchList(tileViewport[index], index)
        }
        rootHandle.MetricsChanged += (metrics) -> {
            if metrics.IsMounted &&
                (Math.Abs(width - metrics.ContentBox.Width) > 1 || Math.Abs(height - metrics.ContentBox.Height) > 1) {
                width = metrics.ContentBox.Width
                height = metrics.ContentBox.Height
                if width < 860 && locationEditing && dialog == "" {
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
                    dialog != "Bookmarks" &&
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
        value.WheelScrollScale = float32(settings.ScrollSpeed)
        value.SmoothScrolling = settings.SmoothScrolling
        browser = BrowserController(value, settings, () -> Changed())
        thumbnails = ThumbnailService(value)
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
        }
        if let done = setupCompletion {
            <-done
        }
        CommitPreferenceBindings()
        settingsWriter?.Dispose()
        browser?.Dispose()
        thumbnails?.Dispose()
    }

    internal func CloseSafely() bool -> !setupBusy && Model.CloseSafely()

    private prop firstFocus ElementHandle {
        get -> if settings.ViewMode == "tiles" {
            tileFocus[0]
        } else {
            listFocus[0]
        }
    }

    private prop secondFocus ElementHandle {
        get -> if settings.ViewMode == "tiles" {
            tileFocus[1]
        } else {
            listFocus[1]
        }
    }

    private prop firstList ElementHandle {
        get -> if settings.ViewMode == "tiles" {
            tileViewport[0]
        } else {
            listViewport[0]
        }
    }

    private prop secondList ElementHandle {
        get -> if settings.ViewMode == "tiles" {
            tileViewport[1]
        } else {
            listViewport[1]
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

    private func Changed() {
        if window != nil {
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
        for index in 0 ... 2 {
            let pane = Model.Pane(index)
            let selection = pane.DirectoryPath + "\0" + pane.Selected.ToString()
            if selections[index] != selection {
                selections[index] = selection
                Host.Post(() -> RevealSelection(index))
            }
        }
    }

    private func WatchList(handle ElementHandle, index int32) {
        var viewport float64 = -1
        var scrollRange float64 = -1
        handle.MetricsChanged += (metrics) -> {
            if !metrics.IsMounted {
                viewport = -1
                scrollRange = -1
                return
            }
            if viewport != metrics.ContentBox.Height || scrollRange != metrics.ScrollRange.Y {
                viewport = metrics.ContentBox.Height
                scrollRange = metrics.ScrollRange.Y
                RevealSelection(index)
            }
        }
    }

    override func Build() Blob {
        if browser == nil {
            return Container{BackgroundColor: palette.Background}
        }
        let p = palette
        let browsing = Splitter(
            "browser-split",
            Pane(0),
            if Model.Split {
                Pane(1)
            } else {
                nil
            },
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
            if BrowsingWidth() < 660 {
                SplitOrientation.Vertical
            } else {
                SplitOrientation.Horizontal
            },
            if BrowsingWidth() < 660 {
                120
            } else {
                260
            },
            if BrowsingWidth() < 660 {
                120
            } else {
                260
            },
            "Resize browsing panes",
            Model.Split
        )
        let workspace = Splitter(
            "preview-split",
            browsing,
            if Model.PreviewVisible {
                PreviewSidebar.Build(Model, settings, () -> Invoke("TogglePreview"), Host, p)
            } else {
                nil
            },
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
            260,
            220,
            "Resize preview",
            Model.PreviewVisible
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
        var bookmarkDrop Func[int32, DropTarget]? = nil
        var bookmarkMenu Action[string, Point]? = nil
        var bookmarkMenuKey Action[string, KeyEvent, Point]? = nil
        if chooser == nil {
            bookmarkDrop = index -> BookmarkDropTarget(index)
            bookmarkMenu = OpenBookmarkContextMenu
            bookmarkMenuKey = OpenBookmarkKeyboardContextMenu
        }
        let main = Splitter(
            "places-split",
            if width >= 860 {
                PlacesSidebar.Build(
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
                    destination -> FileDropTarget(destination),
                    dropPath,
                    chooser == nil,
                    bookmarkDrop,
                    bookmarkDropIndex,
                    bookmarkMenu,
                    bookmarkMenuKey
                )
            } else {
                nil
            },
            browserArea,
            if width >= 860 {
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
            144,
            560,
            "Resize places sidebar",
            width >= 860
        )
        main.Key = "main"
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
        return Container{
            Handle: rootHandle,
            Width: Percent(100),
            Height: Percent(100),
            MinHeight: 0,
            BackgroundColor: p.Background,
            Color: p.Text,
            FontFamily: "sans-serif, Noto Sans CJK",
            FontSize: 13,
            OnKeyDown: HandleKey,
            KeyBindings: WidgetKeyBindings.Editing(window?.PlatformInput),
            Children: children.ToArray(),
        }
    }

    private func Toolbar() Blob {
        let pane = Model.ActivePane()
        let p = palette
        let locationLeft = 124.0
        let locationRight = width - 116 - if width < 860 {
            204.0
        } else {
            174.0
        }
        let locationWidth = Math.Min(
            640,
            Math.Min(locationRight - locationLeft - 80, Math.Max(64, 2 * (locationRight - width / 2)))
        )
        let locationCenter = Math.Clamp(
            width / 2,
            locationLeft + 80 + locationWidth / 2,
            locationRight - locationWidth / 2
        )
        var location Blob = Cell.Mount[BreadcrumbInput, BreadcrumbBar](
            nil,
            BreadcrumbInput{
                Path: pane.DirectoryPath,
                Width: locationWidth,
                Window: Host,
                Palette: p,
                Navigate: destination -> {
                    Model.Navigate(destination)
                    FocusFiles()
                },
                Edit: () -> EditLocation(),
            }
        )
        if locationEditing {
            location = TextEntry{
                Handle: locationHandle,
                Value: locationText,
                Controlled: true,
                Width: locationWidth,
                MaxWidth: 640,
                MinWidth: 0,
                Height: 34,
                Padding: Edges{Left: 10, Right: 10},
                BackgroundColor: p.Surface,
                Color: p.Text,
                BorderRadius: 6,
                BorderWidth: 1,
                BorderColor: p.Accent,
                FontSize: 12,
                Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: "Location"},
                OnChange: value -> {
                    locationText = value
                    Rebuild()
                },
                OnSubmit: value -> {
                    locationEditing = false
                    Model.Navigate(value)
                    FocusFiles()
                },
            }
        }
        let bookmarkNavigation = if width < 860 {
            Ui.Tool("bookmarks", "Open bookmarks", () -> Invoke("OpenBookmarks"), Host, p)
        } else {
            Container{}
        }
        return Container{
            Key: "toolbar",
            Height: 40,
            FlexShrink: 0,
            Padding: Edges{Left: 8, Right: 8},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 3,
                Ui.Tool("arrow_back", "Back", () -> Model.Back(), Host, p, false, !pane.CanBack()),
                Ui.Tool("arrow_forward", "Forward", () -> Model.Forward(), Host, p, false, !pane.CanForward()),
                Ui.Tool(
                    "arrow_upward",
                    "Parent folder",
                    () -> Model.Parent(),
                    Host,
                    p,
                    false,
                    pane.DirectoryPath == "/"
                ),
                Container{Width: 1, Height: 20, Margin: Edges{Left: 8, Right: 8}, BackgroundColor: p.Border},
            },
            Container{Width: locationCenter - locationWidth / 2 - locationLeft, FlexShrink: 0},
            location,
            Container{FlexGrow: 1, MinWidth: 0},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 3,
                bookmarkNavigation,
                if chooser == nil {
                    Ui.Tool(
                        "bookmark",
                        if settings.IsBookmarked(pane.DirectoryPath) {
                            "Remove bookmark"
                        } else {
                            "Bookmark this folder"
                        },
                        () -> Invoke("ToggleBookmark"),
                        Host,
                        p,
                        settings.IsBookmarked(pane.DirectoryPath)
                    )
                } else {
                    Container{}
                },
                Ui.Tool("refresh", "Refresh", () -> Model.Refresh(), Host, p),
                Container{Width: 6},
                Ui.Tool("visibility", "Toggle preview", () -> Invoke("TogglePreview"), Host, p, Model.PreviewVisible),
                if chooser == nil {
                    Ui.Tool(
                        "splitscreen_vertical_add",
                        "Toggle split view",
                        () -> Invoke("ToggleSplit"),
                        Host,
                        p,
                        Model.Split
                    )
                } else {
                    Container{}
                },
                Ui.Tool(
                    "visibility_off",
                    "Toggle hidden files",
                    () -> Invoke("ToggleHidden"),
                    Host,
                    p,
                    settings.ShowHidden
                ),
            },
        }
    }

    private func Pane(index int32) Blob {
        let pane = Model.Pane(index)
        let active = Model.ActiveIndex == index
        let p = palette
        let availableWidth = if Model.Split && BrowsingWidth() >= 660 {
            let firstWidth = SplitSize(BrowsingWidth(), (BrowsingWidth() - 1) * paneRatio, 260, 260)
            if index == 0 {
                firstWidth
            } else {
                BrowsingWidth() - firstWidth - 1
            }
        } else {
            BrowsingWidth()
        }
        let compact = availableWidth < 600
        let handle = if index == 0 {
            firstList
        } else {
            secondList
        }
        let summary = Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 10,
        }
        if chooser == nil {
            summary.Children.Add(
                Ui.Label(
                    FolderName(pane.DirectoryPath),
                    p.Text,
                    if Model.Split {
                        15
                    } else {
                        18
                    },
                    600
                )
            )
        }
        summary.Children.Add(
            Ui.Label(
                if pane.Loading {
                    "Reading folder…"
                } else if pane.VisibleEntries.Count == 1 {
                    "1 item"
                } else {
                    pane.VisibleEntries.Count.ToString() + " items"
                },
                p.Muted,
                11
            )
        )
        let header = List[Blob]()
        header.Add(summary)
        if !Model.Split && availableWidth >= 560 {
            header.Add(
                Cell.Mount[FilterFieldInput, FilterField](
                    nil,
                    FilterFieldInput{
                        Value: pane.Filter,
                        Handle: filterHandle,
                        Palette: p,
                        Width: if width < 950 {
                            142
                        } else {
                            188
                        },
                        OnChange: value -> Model.SetFilter(value),
                        OnSubmit: () -> FocusFiles(),
                    }
                )
            )
            header.Add(Ui.Tool("create_new_folder", "New folder", () -> OpenDialog("New folder", ""), Host, p))
        }
        header.Add(
            Ui.Tool(
                "view_list",
                "List view",
                () -> {
                    Model.SetActive(index)
                    Invoke("ViewList")
                },
                Host,
                p,
                settings.ViewMode == "list"
            )
        )
        header.Add(
            Ui.Tool(
                "grid_view",
                "Tile view",
                () -> {
                    Model.SetActive(index)
                    Invoke("ViewTiles")
                },
                Host,
                p,
                settings.ViewMode == "tiles"
            )
        )
        if chooser == nil {
            header.Add(
                Ui.Tool(
                    "terminal",
                    "Open terminal",
                    () -> {
                        Model.SetActive(index)
                        Invoke("OpenTerminal")
                    },
                    Host,
                    p
                )
            )
        }
        return Container{
            Key: "pane-" + index.ToString(),
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            BorderWidth: Edges{Top: 2},
            BorderColor: if active && Model.Split {
                p.Accent
            } else {
                Color.Transparent
            },
            OnPointerDown: (_) -> Model.SetActive(index),
            OnFocus: (_) -> Model.SetActive(index),
            Container{
                Key: "pane-header",
                Height: chooser != nil ? 36: 44,
                FlexShrink: 0,
                Padding: Edges{Left: 12, Right: 10},
                Gap: 8,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Border,
                Children: header.ToArray(),
            },
            Cell.Mount[FileTableInput, FileTable](
                "table-" + index.ToString(),
                FileTableInput{
                    Host: Host,
                    WordWrap: settings.PreviewWordWrap,
                    Pane: pane,
                    Compact: compact,
                    Tiles: settings.ViewMode == "tiles",
                    Active: active,
                    AutoFocus: active && !(chooser?.Saving ?? false),
                    Choosing: chooser != nil,
                    DirectoriesOnly: (chooser?.Request.Directory ?? false) || (chooser?.SavingMany ?? false),
                    ViewportHandle: handle,
                    FocusHandle: if index == 0 {
                        firstFocus
                    } else {
                        secondFocus
                    },
                    OnKey: ListKey,
                    Keys: ListKeys(),
                    ColumnWidths: if index == 0 {
                        firstWidths
                    } else {
                        secondWidths
                    },
                    OnFittedColumnWidthsChange: widths -> {
                        let merged = Dictionary[string, float64](
                            if index == 0 {
                                firstWidths
                            } else {
                                secondWidths
                            }
                        )
                        for pair in widths {
                            merged[pair.Key] = pair.Value
                        }
                        if index == 0 {
                            firstWidths = merged
                        } else {
                            secondWidths = merged
                        }
                        Rebuild()
                    },
                    OnSelect: (row, ctrl, shift) -> {
                        Model.SetActive(index)
                        let multiple = ChooserAllowsMultiple()
                        Model.Select(row, ctrl && multiple, shift && multiple)
                        ChooserSelectionChanged()
                        FocusFiles()
                    },
                    OnDrag: path -> {
                        if chooser != nil {
                            return nil
                        }
                        Model.SetActive(index)
                        return Model.CreateFileDrag(index, path)
                    },
                    OnDragEnd: () -> {
                        Model.ClearFileDropCache()
                        ClearDropTarget()
                    },
                    DropTarget: destination -> FileDropTarget(destination),
                    DropPath: dropPath,
                    Thumbnails: Thumbnails,
                    OnClear: () -> {
                        Model.SetActive(index)
                        Model.ClearSelection()
                        FocusFiles()
                    },
                    OnContextMenu: (row, point) -> OpenContextMenu(index, row, point),
                    OnOpen: () -> {
                        Model.SetActive(index)
                        OpenBrowserSelection(true)
                    },
                    OnSort: column -> {
                        Model.SetActive(index)
                        Model.Sort(column)
                    },
                    OnText: text -> {
                        Model.SetActive(index)
                        Model.TypeSelect(text)
                    },
                    Palette: p,
                }
            ),
        }
    }

    private func StatusBar() Blob {
        let p = palette
        let info = if notice != "" {
            notice
        } else if Model.Status != "" {
            Model.Status
        } else if Model.SelectedCount() > 1 {
            Model.SelectionSummary()
        } else if let entry = Model.SelectedEntry() {
            entry.Name +
                (
                if entry.IsDirectory {
                    " · Folder"
                } else {
                    " · " + FileSystemService.FormatSize(entry.Size)
                }
            )
        } else {
            "Ready"
        }
        return Container{
            Height: 26,
            Key: "status",
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Padding: Edges{Left: 12, Right: 10},
            Gap: 14,
            BorderWidth: Edges{Top: 1},
            BorderColor: p.Border,
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(info, p.Muted, 11)},
            Ui.Shortcut(settings.Keybindings["TogglePreview"], "Preview", p),
            Ui.Shortcut(settings.Keybindings["ToggleSplit"], "Split", p),
        }
    }

    private func SplitSize(extent float64, requested float64, minimumFirst float64, minimumSecond float64) float64 {
        let available = Math.Max(0, extent - 1)
        let factor = Math.Min(1, available / (minimumFirst + minimumSecond))
        return Math.Clamp(requested, minimumFirst * factor, available - minimumSecond * factor)
    }

    private func WorkspaceWidth() float64 -> width - (
        if width >= 860 {
            SplitSize(width, placesWidth, 144, 560) + 1
        } else {
            0
        }
    )

    private func BrowsingWidth() float64 -> if Model.PreviewVisible {
        SplitSize(
            WorkspaceWidth(),
            (WorkspaceWidth() - 1) * (
                if Model.Split {
                    splitPreviewRatio
                } else {
                    previewRatio
                }
            ),
            260,
            220
        )
    } else {
        WorkspaceWidth()
    }

    private func Splitter(
        key string,
        first Blob?,
        second Blob?,
        value float64,
        change Action[float64],
        unit SplitUnit,
        orientation SplitOrientation,
        minimumFirst float64,
        minimumSecond float64,
        name string,
        enabled bool
    ) Blob -> Cell
        .Mount[SplitPaneInput, SplitPane](
        key,
        SplitPaneInput{
            First: first,
            Second: second,
            Value: value,
            Unit: unit,
            Orientation: orientation,
            MinimumFirst: if enabled {
                minimumFirst
            } else {
                0
            },
            MinimumSecond: if enabled {
                minimumSecond
            } else {
                0
            },
            HandleSize: if enabled {
                1
            } else {
                0
            },
            Disabled: !enabled,
            AccessibilityName: name,
            OnChange: change,
            CreateRoot: (_, root) -> {
                root.FlexGrow = 1
                root.FlexBasis = 0
                return root
            },
            CreateHandle: (_, divider) -> {
                divider.ZIndex = 2
                divider.BackgroundColor = Color.Transparent
                divider.BorderWidth = if !enabled {
                    Edges{}
                } else if orientation == SplitOrientation.Horizontal {
                    Edges{Left: 1}
                } else {
                    Edges{Top: 1}
                }
                divider.BorderColor = palette.Border
                divider.Hover = Style{BorderColor: palette.Accent}
                divider.Focus = Style{BorderColor: palette.Accent}
                if enabled {
                    divider.Children.Add(
                        Container{
                            Position: PositionType.Absolute,
                            Left: if orientation == SplitOrientation.Horizontal {
                                -3
                            } else {
                                0
                            },
                            Right: if orientation == SplitOrientation.Horizontal {
                                -3
                            } else {
                                0
                            },
                            Top: if orientation == SplitOrientation.Horizontal {
                                0
                            } else {
                                -3
                            },
                            Bottom: if orientation == SplitOrientation.Horizontal {
                                0
                            } else {
                                -3
                            },
                            HitTestSelf: true,
                            Cursor: if orientation == SplitOrientation.Horizontal {
                                Cursor.ResizeHorizontal
                            } else {
                                Cursor.ResizeVertical
                            },
                        }
                    )
                }
                return divider
            },
        }
    )

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
