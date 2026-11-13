package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func Location(index int32, crumbWidth float64) Blob {
        let pane = Model.Pane(index)
        let p = palette

        if locationEditing && Model.ActiveIndex == index {
            return TextField
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
                width: crumbWidth,
                handle: locationHandle,
                fontSize: 12
            ){.Key: "location-edit"}
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
                More: (paths, point) -> OpenPathMenu(index, paths, point),
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
        var toolsWidth = 0.0

        PaneTools(index, pane, p, availableWidth, location, tools, ref toolsWidth)

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
                Height: chooser != nil ? 36: Ui.BarHeight,
                FlexShrink: 0,
                Padding: Edges{Left: 7, Right: 8},
                Gap: 8,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Border,
                Opacity: Model.Split && !active ? .6: 1,
                Location(index, Math.Max(0, availableWidth - 23 - toolsWidth)),
                Container{
                    Key: "tools",
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    FlexShrink: 0,
                    Gap: Ui.ToolsGap,
                    Children: tools.ToArray(),
                },
            },
            PaneTable(index, pane, active, p, availableWidth < 600, location),
        }
    }

    private func PaneTools(
        index int32,
        pane BrowserPane,
        p Palette,
        availableWidth float64,
        location LocationKind,
        tools List[Blob],
        ref toolsWidth float64
    ) {
        if !Model.Split && availableWidth >= 560 {
            toolsWidth = if width < 950 {
                142
            } else {
                188
            }
            tools.Add(
                Cell.Mount[FilterFieldInput, FilterField](
                    nil,
                    FilterFieldInput{
                        Value: pane.Filter,
                        Handle: filterHandle,
                        Palette: p,
                        Width: toolsWidth,
                        OnChange: value -> Model.SetFilter(value),
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
                        Invoke("FocusFilter")
                    },
                    Host,
                    p,
                    pane.Filter != ""
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
                    location != LocationKind.Folder
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
                settings.ViewMode == ViewMode.List
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
                settings.ViewMode == ViewMode.Tiles
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
                    location == LocationKind.Recent
                )
            )
        }

        toolsWidth += (tools.Count - (toolsWidth > 0 ? 1: 0)) * Ui.ToolSize + (tools.Count - 1) * Ui.ToolsGap
    }

    private func PaneTable(
        index int32,
        pane BrowserPane,
        active bool,
        p Palette,
        compact bool,
        location LocationKind
    ) Blob {
        let state = paneViews[index]
        let handle = PaneViewport(index)

        return Cell.Mount[FileTableInput, FileTable](
            "table-" + index.ToString(),
            FileTableInput{
                Host: Host,
                WordWrap: settings.PreviewWordWrap,
                Pane: pane,
                Location: location,
                Compact: compact,
                ShowType: settings.ShowTypeColumn,
                SizeText: entry -> pane.Kind == LocationKind.Archive && entry.IsDirectory ? "—": FileSizeText(entry),
                OnHeaderMenu: point -> OpenColumnMenu(index, point),
                Tiles: settings.ViewMode == ViewMode.Tiles,
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
                    Model.Sort(column)
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
        if pane.Selected >= 0 && pane.Selected < pane.VisibleEntries.Count {
            PaneViewport(index).ScrollToItem(pane.VisibleEntries[pane.Selected].FullPath, ScrollAlignment.Nearest)
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

        locationHandle.SelectText(0, locationText.Length)

        Rebuild()
    }
}
