package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func WatchList(
        handle ElementHandle,
        state BrowserPaneViewState,
        offset Point? = nil,
        generation int32 = -1
    ) {
        var viewport float64 = -1
        var scrollRange float64 = -1
        var room float64 = -1
        var restore = offset

        handle.MetricsChanged += (metrics) -> {
            if !metrics.IsMounted {
                viewport = -1
                scrollRange = -1
                room = -1
                return
            }
            if let saved = restore {
                restore = nil
                if state.Pane.ViewGeneration == generation && metrics.ScrollOffset != saved {
                    handle.JumpTo(saved.X, saved.Y)
                }
            }

            if room != metrics.ContentBox.Width {
                room = metrics.ContentBox.Width

                if settings.ViewMode == ViewMode.Tiles {
                    Rebuild()
                }
            }

            if viewport != metrics.ContentBox.Height || scrollRange != metrics.ScrollRange.Y {
                viewport = metrics.ContentBox.Height
                scrollRange = metrics.ScrollRange.Y

                if state.RevealPending {
                    RevealSelection(state)
                }
            }
        }
    }

    private func Location(index int32, crumbWidth float64) Blob {
        let pane = Model.Pane(index)
        let p = palette

        if locationEditing && Model.ActiveIndex == index {
            return Container{
                Key: "location-edit",
                Width: crumbWidth,
                Height: 30,
                FlexShrink: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 2,
                Padding: Edges{Left: 8, Right: 3},
                BackgroundColor: p.Surface,
                BorderWidth: 1,
                BorderColor: p.Accent,
                BorderRadius: p.ControlRadius,
                TextField
                    .Build(
                    locationText,
                    value -> {
                        locationText = value
                        Rebuild()
                    },
                    value -> {
                        locationEditing = false
                        Model.Navigate(value)
                        FocusFiles()
                    },
                    "Location",
                    p,
                    handle: locationHandle,
                    fontSize: 12
                ){
                    .FlexGrow: 1,
                    .FlexBasis: 0,
                    .Height: 26,
                    .Padding: 0,
                    .BackgroundColor: Color.Transparent,
                    .BorderWidth: 0,
                    .OutlineWidth: 0,
                    .FocusStyle: Style{BorderWidth: 0, OutlineWidth: 0},
                },
                Ui.Tool(
                    "check",
                    "Open location",
                    () -> {
                        locationEditing = false
                        Model.Navigate(locationText)
                        FocusFiles()
                    },
                    Host,
                    p,
                    size: 24,
                    iconSize: 15,
                    shortcut: "Enter"
                ),
                Ui.Tool(
                    "close",
                    "Cancel",
                    () -> {
                        locationEditing = false
                        FocusFiles()
                        Rebuild()
                    },
                    Host,
                    p,
                    size: 24,
                    iconSize: 15,
                    shortcut: "Escape"
                ),
            }
        }

        return Cell.Mount[BreadcrumbInput, BreadcrumbBar](
            "location-" + index.ToString(),
            BreadcrumbInput{
                Path: pane.DirectoryPath,
                Kind: pane.Kind,
                Trash: Model.TrashDirectory,
                Home: home,
                Width: crumbWidth,
                Window: Host,
                Palette: p,
                Navigate: destination -> {
                    Model.SetActive(index)
                    Model.Navigate(destination)
                    FocusFiles()
                },
                Edit: () -> {
                    Model.SetActive(index)
                    EditLocation()
                },
                EditShortcut: settings.ShortcutFor("FocusLocation"),
                More: (paths, point) -> OpenPathMenu(index, paths, point),
                CloudSegments: pane.Kind == LocationKind.Cloud ? Model.GoogleDrive.BreadcrumbChain(
                    pane.DirectoryPath
                ): nil,
            }
        )
    }

    private func Pane(index int32) Blob {
        let pane = Model.Pane(index)
        let active = Model.ActiveIndex == index
        let p = palette
        let availableWidth = PaneWidth(index)
        let location = pane.Kind
        let tools = List[Blob]()

        PaneTools(index, pane, p, availableWidth, location, tools)

        return Container{
            Key: "pane-" + index.ToString(),
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            BorderWidth: Edges{Top: Model.Split ? 2: 0},
            BorderColor: if active && Model.Split {
                p.Accent
            } else {
                Color.Transparent
            },
            OnPointerDown: (_) -> Model.SetActive(index),
            OnFocus: (_) -> Model.SetActive(index),
            Container{
                Key: "pane-header",
                Height: chooser != nil ? 37: Ui.BarHeight + 1,
                FlexShrink: 0,
                Padding: Edges{Left: Ui.CardInset, Right: Ui.CardInset},
                Gap: Ui.CardInset,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Border,
                Opacity: Model.Split && !active ? .6: 1,
                Sized(size -> Location(index, size.Width)){.FlexGrow: 1, .FlexBasis: 0, .MinWidth: 0, .Height: 30},
                Container{
                    Key: "tools",
                    Height: 30,
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    FlexShrink: 0,
                    Gap: Ui.ToolsGap,
                    Children: tools.ToArray(),
                },
            },
            if active && (inlineFilterOpen || pane.Filter != "") && (Model.Split || availableWidth < 560) {
                Container{
                    Key: "inline-filter",
                    Padding: Edges{Left: Ui.CardInset, Right: Ui.CardInset, Top: 6, Bottom: 6},
                    BorderWidth: Edges{Bottom: 1},
                    BorderColor: p.Border,
                    Cell.Mount[FilterFieldInput, FilterField](
                        nil,
                        FilterFieldInput{
                            Value: pane.Filter,
                            Width: Percent(100),
                            MatchCount: pane.VisibleEntries.Count,
                            TotalCount: pane.Entries.Count,
                            Handle: filterHandle,
                            Window: Host,
                            Palette: p,
                            OnChange: value -> Model.SetFilter(value),
                            OnClear: () -> {
                                Model.SetFilter("")
                                inlineFilterOpen = false
                                FocusFiles()
                            },
                            OnMoveSelection: delta -> Model.MoveSelection(delta, false, false),
                            OnSubmit: () -> FocusFiles(),
                        }
                    ),
                }
            } else {
                Container{}
            },
            PaneTable(index, pane, active, p, location),
        }
    }

    private func PaneTools(
        index int32,
        pane BrowserPane,
        p Palette,
        availableWidth float64,
        location LocationKind,
        tools List[Blob]
    ) {
        if !Model.Split && availableWidth >= 560 {
            let filterWidth = width < 950 ? 156: 210
            tools.Add(
                Cell.Mount[FilterFieldInput, FilterField](
                    nil,
                    FilterFieldInput{
                        Value: pane.Filter,
                        MatchCount: pane.VisibleEntries.Count,
                        TotalCount: pane.Entries.Count,
                        Handle: filterHandle,
                        Window: Host,
                        Palette: p,
                        Width: filterWidth,
                        OnChange: value -> Model.SetFilter(value),
                        OnClear: () -> {
                            Model.SetFilter("")
                            inlineFilterOpen = false
                            FocusFiles()
                        },
                        OnMoveSelection: delta -> Model.MoveSelection(delta, false, false),
                        OnSubmit: () -> FocusFiles(),
                    }
                )
            )
        } else if availableWidth >= 400 {
            tools.Add(
                Ui.Tool(
                    "search",
                    "Filter files",
                    () -> {
                        Model.SetActive(index)
                        if inlineFilterOpen && pane.Filter == "" {
                            inlineFilterOpen = false
                            FocusFiles()
                            Rebuild()
                        } else {
                            Invoke("FocusFilter")
                        }
                    },
                    Host,
                    p,
                    inlineFilterOpen || pane.Filter != "",
                    shortcut: settings.ShortcutFor("FocusFilter")
                )
            )
        }

        if availableWidth >= 400 {
            tools.Add(
                Ui.Tool(
                    "create_new_folder",
                    "New folder",
                    () -> {
                        Model.SetActive(index)
                        Invoke("NewFolder")
                    },
                    Host,
                    p,
                    false,
                    location != LocationKind.Folder,
                    shortcut: settings.ShortcutFor("NewFolder")
                )
            )
        }

        tools.Add(
            Ui.Tool(
                "view_list",
                "List view",
                () -> {
                    Model.SetActive(index)
                    Invoke("ViewList")
                },
                Host,
                p,
                settings.ViewMode == ViewMode.List,
                shortcut: settings.ShortcutFor("ViewList")
            )
        )
        tools.Add(
            Ui.Tool(
                "grid_view",
                "Tile view",
                () -> {
                    Model.SetActive(index)
                    Invoke("ViewTiles")
                },
                Host,
                p,
                settings.ViewMode == ViewMode.Tiles,
                shortcut: settings.ShortcutFor("ViewTiles")
            )
        )

        if chooser == nil {
            tools.Add(
                Ui.Tool(
                    "terminal",
                    "Open terminal",
                    () -> {
                        Model.SetActive(index)
                        Invoke("OpenTerminalHere")
                    },
                    Host,
                    p,
                    false,
                    location == LocationKind.Recent,
                    shortcut: settings.ShortcutFor("OpenTerminalHere")
                )
            )
        }
    }

    private func PaneTable(index int32, pane BrowserPane, active bool, p Palette, location LocationKind) Blob {
        let state = paneViews[index]
        let handle = PaneViewport(index)

        return Cell.Mount[FileTableInput, FileTable](
            "table-" + index.ToString(),
            FileTableInput{
                Host: Host,
                WordWrap: settings.PreviewWordWrap,
                Pane: pane,
                Location: location,
                ShowModified: settings.ShowModifiedColumn,
                ShowCreated: settings.ShowCreatedColumn,
                ShowType: settings.ShowTypeColumn,
                ShowExtension: settings.ShowExtensionColumn,
                ShowPermissions: settings.ShowPermissionsColumn,
                ShowSize: settings.ShowSizeColumn,
                SizeText: entry -> pane.Kind == LocationKind.Archive && entry.IsDirectory ? "—": FileSizeText(entry),
                OnHeaderMenu: point -> OpenColumnMenu(index, point),
                Tiles: settings.ViewMode == ViewMode.Tiles,
                TileWidth: TileWidth(index),
                ScrollbarInset: if !Model.PreviewVisible &&
                    (!Model.Split || BrowsingWidth() < SplitBreakpoint || index == Model.Panes.Count - 1) {
                    Host.ResizeBand + 2
                } else {
                    2
                },
                Active: active,
                AutoFocus: active && !(chooser?.Saving ?? false),
                Choosing: chooser != nil,
                DirectoriesOnly: (chooser?.Request.Directory ?? false) || (chooser?.SavingMany ?? false),
                ViewportHandle: handle,
                FocusHandle: PaneFocus(index),
                OnKey: ListKey,
                Keys: ListKeys(),
                ColumnWidths: state.ColumnWidths,
                OnFittedColumnWidthsChange: widths -> {
                    let merged = Dictionary[string, float64](state.ColumnWidths)
                    for pair in widths {
                        merged[pair.Key] = pair.Value
                    }
                    state.ColumnWidths = merged
                    Rebuild()
                },
                OnFocusRow: row -> {
                    Model.SetActive(index)
                    Model.MoveTo(row, true)
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
                    return CreateFileDrag(index, path)
                },
                OnDragEnd: () -> {
                    transfers.Clear()
                    ClearDropTarget()
                },
                DropTarget: destination -> FileDropTarget(destination),
                DropPath: dropPath,
                AcquireThumbnail: Thumbnails.Acquire,
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
                    state.RevealPending = false
                    Model.Sort(column)
                    state.SortGeneration = pane.ViewGeneration
                    SavePreferences()
                },
                OnText: text -> {
                    Model.SetActive(index)
                    TypeSelect(text)
                },
                Palette: p,
            }
        )
    }

    private func FileSizeText(entry FileEntry) string {
        if !entry.IsDirectory {
            return FileSystemService.FormatSize(entry.Size)
        }

        let count = FolderCounts.Count(entry, settings.ShowHidden)

        if count < 0 {
            return count == -1 ? "": "—"
        }

        return count == 1 ? "1 item": count.ToString() + " items"
    }

    private func RevealSelection(state BrowserPaneViewState) {
        let index = Model.Panes.IndexOf(state.Pane)

        if index < 0 {
            return
        }

        let pane = state.Pane

        if pane.Selected >= 0 {
            let list = PaneViewport(index)
            let tiles = settings.ViewMode == ViewMode.Tiles
            let row = if tiles {
                pane.Selected / TileColumns(index)
            } else {
                pane.Selected
            }
            let rowHeight = if tiles {
                FileTiles.TileHeight + FileTiles.Gap
            } else {
                palette.RowHeight
            }
            let top = row * rowHeight
            let bottom = top + if tiles {
                FileTiles.TileHeight
            } else {
                rowHeight
            }
            let offset = list.ScrollOffset.Y
            let viewport = list.ContentBox.Height

            if top < offset {
                list.JumpTo(0, top)
            } else if bottom > offset + viewport {
                list.JumpTo(0, Math.Max(0, bottom - viewport))
            }

            state.RevealPending = bottom > list.ScrollRange.Y + viewport
        } else {
            state.RevealPending = false
        }
    }

    private func FocusFiles() {
        PaneFocus(Model.ActiveIndex).Focus()
    }

    private func EditLocation() {
        if PaneWidth(Model.ActiveIndex) < 360 {
            OpenDialog(DialogKind.OpenLocation, Model.ActivePane().DirectoryPath)
            return
        }

        locationText = Model.ActivePane().DirectoryPath
        locationEditing = true

        if locationHandle.IsMounted {
            locationHandle.Focus()
            Host.Focus.Execute(TextCommand{Kind: TextCommandKind.SelectAll})
        } else {
            locationFocusPending = true
        }

        Rebuild()
    }
}
