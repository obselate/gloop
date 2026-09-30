package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import System
import System.Collections.Generic

internal data struct FileTableInput {
    var Host Window
    var Pane BrowserPane
    var Compact bool
    var Tiles bool
    var WordWrap bool
    var Active bool
    var FocusHandle ElementHandle
    var ViewportHandle ElementHandle
    var OnKey Action[KeyEvent]
    var Keys[]KeyBinding
    var ColumnWidths IReadOnlyDictionary[string, float64]
    var OnFittedColumnWidthsChange Action[IReadOnlyDictionary[string, float64]]
    var OnSelect Action[int32, bool, bool]
    var OnDrag((string) -> DragData?)
    var OnDragEnd Action
    var DropTarget Func[string, DropTarget]
    var DropPath string
    var OnClear Action
    var Thumbnails ThumbnailService
    var OnOpen Action
    var OnSort Action[string]
    var OnText Action[string]
    var Palette Palette
}

open class FileTable : Cell[FileTableInput] {
    private let clicks FileClickState = FileClickState()
    internal const RowHeight float64 = 30
    private var entries List[FileEntry]?
    private var rows[]DataGridRow = []DataGridRow{}
    private var indices Dictionary[string, int32] = Dictionary[string, int32]()

    protected override func Build(value FileTableInput) Blob {
        if value.Tiles {
            return Cell.Mount[FileTableInput, FileTiles]("tiles", value)
        }
        let pane = value.Pane
        let p = value.Palette
        if !Object.ReferenceEquals(entries, pane.VisibleEntries) {
            entries = pane.VisibleEntries
            rows = [pane.VisibleEntries.Count]DataGridRow
            indices = Dictionary[string, int32](StringComparer.Ordinal)
            for index in 0 ... pane.VisibleEntries.Count {
                let entry = pane.VisibleEntries[index]
                rows[index] = DataGridRow{Id: entry.FullPath, Label: entry.Name}
                indices[entry.FullPath] = index
            }
        }
        let columns = List[DataGridColumn]()
        columns.Add(DataGridColumn{Id: "name", Label: "Name", Minimum: 150, Sortable: true})
        if !value.Compact {
            columns.Add(DataGridColumn{Id: "modified", Label: "Modified", Width: 136, Minimum: 90, Sortable: true})
            columns.Add(DataGridColumn{Id: "kind", Label: "Type", Width: 104, Minimum: 70, Sortable: true})
        }
        columns.Add(DataGridColumn{Id: "size", Label: "Size", Width: 88, Minimum: 60, Sortable: true})
        let selected = [pane.SelectedPaths.Count]string
        pane.SelectedPaths.CopyTo(selected)
        return Cell.Mount[DataGridInput, DataGrid](
            "grid",
            DataGridInput{
                Columns: columns.ToArray(),
                Rows: rows,
                ColumnWidths: value.ColumnWidths,
                FitColumnsToViewport: true,
                OnFittedColumnWidthsChange: value.OnFittedColumnWidthsChange,
                RootHandle: value.FocusHandle,
                ViewportHandle: value.ViewportHandle,
                UseDefaultKeyboard: false,
                OnTextInput: value.OnText,
                OnKeyDown: value.OnKey,
                ScrollbarX: Ui.ScrollbarStyle(p),
                ScrollbarVisibilityX: ScrollbarVisibility.Auto,
                ScrollbarY: Ui.ScrollbarStyle(p, 8),
                ScrollbarVisibilityY: ScrollbarVisibility.Always,
                EmptyContent: Empty(pane, p),
                Selection: DataGridSelection.Multiple,
                SelectedIds: selected,
                ActiveRowId: if pane.Selected >= 0 && pane.Selected < pane.VisibleEntries.Count {
                    pane.VisibleEntries[pane.Selected].FullPath
                } else {
                    nil
                },
                OnSelectionRequest: (id, ctrl, shift) -> {
                    if indices.TryGetValue(id, out var index) {
                        FileTransferUi.Select(pane.VisibleEntries[index], index, value, clicks, ctrl, shift)
                    }
                },
                SortColumnId: pane.SortColumn,
                SortDirection: if pane.Descending {
                    DataGridSort.Descending
                } else {
                    DataGridSort.Ascending
                },
                OnSort: (column, _) -> value.OnSort(column),
                Height: Percent(100),
                RowHeight: RowHeight,
                HeaderHeight: 28,
                BackgroundColor: p.Background,
                TextColor: p.Text,
                SelectedColor: p.Selection,
                AccessibilityName: "Files in " + pane.DirectoryPath,
                HeaderStyle: Style{BackgroundColor: p.Background, BorderWidth: Edges{Bottom: 1}, BorderColor: p.Border},
                ResizeHandleStyle: Style{
                    BackgroundColor: Color.Transparent,
                    BorderWidth: Edges{Left: 1},
                    BorderColor: p.Border,
                },
                CreateResizeHandle: (_, _, handle) -> {
                    handle.Hover = Style{BorderColor: p.Accent}
                    handle.Focus = Style{BorderColor: p.Accent}
                    return handle
                },
                CreateRoot: (_, root) -> {
                    root.FlexGrow = 1
                    root.FlexBasis = 0
                    root.BorderRadius = 0
                    root.DropTarget = value.DropTarget(pane.DirectoryPath)
                    root.OutlineWidth = value.DropPath == pane.DirectoryPath ? 1: 0
                    root.OutlineColor = p.Accent
                    root.OutlineOffset = -1
                    root.AutoFocus = value.Active
                    root.KeyBindings = value.Keys
                    root.OnPointerDown = e -> {
                        if e.Button == PointerButton.Primary && !e.IsFromInteractiveChild
                        && !e.Modifiers.Ctrl && !e.Modifiers.Shift && !e.Modifiers.Super {
                            value.OnClear()
                        }
                    }
                    return root
                },
                CreateHeader: (_, column, _) -> Container{
                    Width: Percent(100),
                    MinWidth: 0,
                    AlignItems: if column.Id == "size" {
                        AlignItems.FlexEnd
                    } else {
                        AlignItems.FlexStart
                    },
                    Padding: Edges{
                        Left: if column.Id == "name" {
                            26
                        } else {
                            0
                        }
                    },
                    Ui.Label(
                        (column.Label ?? "") +
                            (
                            if pane.SortColumn == column.Id {
                                if pane.Descending {
                                    "  ↓"
                                } else {
                                    "  ↑"
                                }
                            } else {
                                ""
                            }
                        ),
                        if pane.SortColumn == column.Id {
                            p.Text
                        } else {
                            p.Muted
                        },
                        11,
                        500
                    ),
                },
                CreateCell: (_, row, column, _) -> CellContent(
                    pane.VisibleEntries[indices[(row.Id ?? "")]],
                    (column.Id ?? ""),
                    pane.SelectedPaths.Contains(row.Id ?? ""),
                    value.Thumbnails,
                    p
                ),
                CreateRow: (_, row, root) -> {
                    let selectedRow = pane.SelectedPaths.Contains(row.Id ?? "")
                    let focused = pane.Selected >= 0 && pane.VisibleEntries[pane.Selected].FullPath == row.Id
                    root.OutlineWidth = if focused && value.Active {
                        1
                    } else {
                        0
                    }
                    root.OutlineColor = p.Accent
                    root.Hover = Style{
                        BackgroundColor: if selectedRow {
                            p.Selection
                        } else {
                            p.Surface
                        }
                    }
                    return FileTransferUi.Bind(root, pane.VisibleEntries[indices[(row.Id ?? "")]], value, clicks)
                },
            }
        )
    }

    private func CellContent(
        entry FileEntry,
        column string,
        selected bool,
        thumbnails ThumbnailService,
        p Palette
    ) Blob {
        if column == "name" {
            let label = Ui.Label(
                entry.Name + if entry.IsSymlink {
                    " ↗"
                } else {
                    ""
                },
                p.Text
            )
            label.Key = "name"
            return Container{
                MinWidth: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Cell.Mount[FilePreviewInput, FilePreview](
                    "thumbnail",
                    FilePreviewInput{Entry: entry, Service: thumbnails, Tile: false, Palette: p}
                ),
                label,
            }
        }
        let text = switch column {
            case "modified": entry.Modified.ToString("dd MMM yyyy")
            case "kind": entry.Kind
            default: if entry.IsDirectory {
                "—"
            } else {
                FileSystemService.FormatSize(entry.Size)
            }
        }
        return Container{
            MinWidth: 0,
            AlignItems: if column == "size" {
                AlignItems.FlexEnd
            } else {
                AlignItems.FlexStart
            },
            Ui.Label(
                text,
                if selected {
                    p.Text
                } else {
                    p.Muted
                },
                12
            ),
        }
    }

    shared {
        internal func Empty(pane BrowserPane, p Palette) Blob {
            if pane.Loading {
                return Ui.Empty("hourglass_empty", "Opening folder", "Reading the directory…", p)
            }
            if pane.Error != "" {
                return Ui.Empty("folder_off", "Unable to open folder", pane.Error, p)
            }
            return Ui.Empty(
                "folder_open",
                if pane.Filter == "" {
                    "This folder is empty"
                } else {
                    "No matching files"
                },
                if pane.Filter == "" {
                    "Create a folder or paste files here."
                } else {
                    "Try a different name or clear the filter."
                },
                p
            )
        }

        internal func IconName(entry FileEntry) string {
            if entry.IsDirectory {
                return "folder"
            }
            let extension = System.IO.Path.GetExtension(entry.Name).ToLowerInvariant()
            return switch extension {
                case ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".svg": "image"
                case ".zip" or ".gz" or ".tar" or ".7z" or ".xz": "folder_zip"
                case ".mp3" or ".flac" or ".wav" or ".ogg": "audio_file"
                case ".mp4" or ".mkv" or ".webm": "video_file"
                case ".gs" or ".cs" or ".rs" or ".go" or ".js" or ".ts" or ".py" or ".sh" or ".json": "code"
                default: "draft"
            }
        }
    }
}
