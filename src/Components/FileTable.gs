package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import System
import System.Collections.Generic

open class FileTable : Cell[FileTableInput] {
    private let clicks FileClickState = FileClickState()
    internal const RowHeight float64 = 30
    private var entries List[FileEntry]?
    private var rows[]DataGridRow = []DataGridRow{}
    private var indices Dictionary[string, int32] = Dictionary[string, int32]()

    protected override func Build(value FileTableInput) Blob {
        if value.Tiles {
            if entries != nil {
                entries = nil
                rows = []DataGridRow{}
                indices = Dictionary[string, int32](StringComparer.Ordinal)
            }

            return Cell.Mount[FileTableInput, FileTiles]("tiles", value)
        }

        let pane = value.Pane
        let p = value.Palette

        if !Object.ReferenceEquals(entries, pane.VisibleEntries) {
            entries = pane.VisibleEntries
            rows = [pane.VisibleEntries.Count]DataGridRow
            indices = Dictionary[string, int32](pane.VisibleEntries.Count, StringComparer.Ordinal)

            for index in 0 ... pane.VisibleEntries.Count {
                let entry = pane.VisibleEntries[index]
                rows[index] = DataGridRow{Id: entry.FullPath, Label: entry.Name}
                indices[entry.FullPath] = index
            }
        }

        let columns = BuildColumns(value)
        let selected = [pane.SelectedPaths.Count]string
        pane.SelectedPaths.CopyTo(selected)

        let grid = Cell.Mount[DataGridInput, DataGrid](
            "grid",
            DataGridInput{
                Columns: columns,
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
                ScrollbarY: Ui.ScrollbarStyle(p),
                ScrollbarVisibilityY: ScrollbarVisibility.Always,
                EmptyContent: Empty(pane, p, value.Location, value.Choosing, value.DirectoriesOnly),
                Selection: DataGridSelection.Multiple,
                SelectedIds: selected,
                ActiveRowId: if pane.Selected >= 0 && pane.Selected < pane.VisibleEntries.Count {
                    pane.VisibleEntries[pane.Selected].FullPath
                } else {
                    nil
                },
                OnActiveRowChange: id -> {
                    if indices.TryGetValue(id, out var index) {
                        value.OnFocusRow(index)
                    }
                },
                OnSelectionRequest: (id, ctrl, shift) -> {
                    if indices.TryGetValue(id, out var index) {
                        FileTransferUi.Select(pane.VisibleEntries[index], index, value, clicks, ctrl, shift)
                    }
                },
                SortColumnId: ColumnId(pane.SortColumn),
                SortDirection: if pane.Descending {
                    DataGridSort.Descending
                } else {
                    DataGridSort.Ascending
                },
                OnSort: (column, _) -> value.OnSort(ColumnKind(column)),
                Height: Percent(100),
                RowHeight: RowHeight,
                HeaderHeight: 28,
                BackgroundColor: p.Canvas,
                TextColor: p.Text,
                SelectedColor: value.Active ? p.Selection: p.Hover,
                AccessibilityName: "Files in " + pane.DirectoryPath,
                HeaderStyle: Style{BackgroundColor: p.Canvas, BorderWidth: Edges{Bottom: 1}, BorderColor: p.Border},
                ResizeHandleStyle: Style{
                    BackgroundColor: Color.Transparent,
                    BorderWidth: Edges{Left: 1},
                    BorderColor: p.Border,
                },
                CreateResizeHandle: (_, _, handle) -> {
                    handle.Hover = Style{BorderColor: p.Accent}
                    handle.Focus = p.FocusBorder()
                    return handle
                },
                CreateRoot: (_, root) -> BuildRoot(root, value),
                CreateHeader: (_, column, _) -> BuildHeader(column, value),
                CreateCell: (_, row, column, _) -> CellContent(
                    pane.VisibleEntries[indices[(row.Id ?? "")]],
                    (column.Id ?? ""),
                    pane.SelectedPaths.Contains(row.Id ?? ""),
                    value,
                    p
                ),
                CreateRow: (_, row, root) -> {
                    let selectedRow = pane.SelectedPaths.Contains(row.Id ?? "")
                    let focused = pane.Selected >= 0 && pane.VisibleEntries[pane.Selected].FullPath == row.Id
                    root.OutlineWidth = if focused && value.Active && p.Keyboard {
                        1
                    } else {
                        0
                    }
                    root.OutlineColor = p.Accent
                    root.BorderRadius = 6
                    root.Hover = Style{
                        BackgroundColor: if selectedRow {
                            p.Selection
                        } else {
                            p.Hover
                        }
                    }
                    return FileTransferUi.Bind(root, pane.VisibleEntries[indices[(row.Id ?? "")]], value, clicks)
                },
            }
        )

        return Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, MinHeight: 0, Padding: Edges{Left: 6}, grid,}
    }

    private func BuildColumns(value FileTableInput)[]DataGridColumn {
        let columns = List[DataGridColumn]()
        columns.Add(DataGridColumn{Id: "name", Label: "Name", Minimum: 150, Sortable: true})

        if !value.Compact {
            columns.Add(DataGridColumn{Id: "modified", Label: "Modified", Width: 136, Minimum: 90, Sortable: true})
        }

        if !value.Compact && value.ShowType {
            columns.Add(DataGridColumn{Id: "kind", Label: "Type", Width: 104, Minimum: 70, Sortable: true})
        }

        columns.Add(DataGridColumn{Id: "size", Label: "Size", Width: 88, Minimum: 60, Sortable: true})

        return columns.ToArray()
    }

    private func BuildRoot(root Container, value FileTableInput) Container {
        root.FlexGrow = 1
        root.FlexBasis = 0
        root.BorderRadius = 0
        root.AutoFocus = value.AutoFocus
        root.KeyBindings = value.Keys

        return FileTransferUi.Root(root, value, clicks)
    }

    private func BuildHeader(column DataGridColumn, value FileTableInput) Blob {
        let pane = value.Pane
        let p = value.Palette
        let sorted = pane.SortColumn == ColumnKind(column.Id ?? "")

        return Container{
            Width: Percent(100),
            MinWidth: 0,
            Opacity: value.Active ? 1: .6,
            OnPointerUp: e -> {
                if e.Button == PointerButton.Secondary {
                    e.PreventDefault()
                    e.StopPropagation()
                    value.OnHeaderMenu(e.WindowPosition)
                }
            },
            AlignItems: if column.Id == "size" {
                AlignItems.FlexEnd
            } else {
                AlignItems.FlexStart
            },
            Padding: Edges{
                Left: if column.Id == "name" {
                    30
                } else {
                    0
                }
            },
            Container{
                FlexDirection: FlexDirection.Row,
                Gap: sorted ? 6: 0,
                Ui.Label(column.Label ?? "", sorted ? p.Text: p.Muted, 11, 500),
                Ui.Label(!sorted ? "": pane.Descending ? "↓": "↑", p.Accent, 11, 700),
            },
        }
    }

    private func CellContent(entry FileEntry, column string, selected bool, value FileTableInput, p Palette) Blob {
        if column == "name" {
            let label = Ui.Label(FileTransferUi.Name(entry), p.Text)
            label.Key = "name"

            return Container{
                MinWidth: 0,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Cell.Mount[FilePreviewInput, FilePreview](
                    "thumbnail",
                    FilePreviewInput{Entry: entry, Acquire: value.AcquireThumbnail, Tile: false, Palette: p}
                ),
                label,
            }
        }

        let today = column == "modified" && entry.Modified.Date == DateTime.Today
        let text = switch column {
            case "modified": FileEntry.FormatDate(entry.Modified, compact: true)
            case "kind": entry.Kind
            default: value.SizeText(entry)
        }

        return Container{
            MinWidth: 0,
            AlignItems: if column == "size" {
                AlignItems.FlexEnd
            } else {
                AlignItems.FlexStart
            },
            Ui.Label(text, selected || today ? p.Text: p.Muted, 12, today ? 600: 400),
        }
    }

    shared {
        private func ColumnKind(id string) SortColumn -> switch id {
            case "modified": SortColumn.Modified
            case "kind": SortColumn.Kind
            case "size": SortColumn.Size
            default: SortColumn.Name
        }

        private func ColumnId(column SortColumn) string -> switch column {
            case SortColumn.Modified: "modified"
            case SortColumn.Kind: "kind"
            case SortColumn.Size: "size"
            default: "name"
        }

        internal func Empty(
            pane BrowserPane,
            p Palette,
            location LocationKind,
            choosing bool = false,
            directoriesOnly bool = false
        ) Blob {
            if pane.Loading {
                return Ui.Empty("hourglass_empty", "Opening folder", "Reading the directory…", p)
            }

            if pane.Error != "" {
                return Ui.Empty("folder_off", "Unable to open folder", pane.Error, p)
            }

            let empty = pane.Filter == "" && (!choosing || pane.Entries.Count == 0)

            return Ui.Empty(
                "folder_open",
                if empty && location == LocationKind.Recent {
                    "No recent files"
                } else if empty && location == LocationKind.Trash {
                    "Trash is empty"
                } else if empty {
                    "This folder is empty"
                } else if directoriesOnly {
                    "No matching folders"
                } else {
                    "No matching files"
                },
                if choosing && (empty || (directoriesOnly && pane.Filter == "")) {
                    "Create a folder here."
                } else if choosing && pane.Filter == "" {
                    "Choose another folder or file type."
                } else if pane.Filter == "" && location == LocationKind.Recent {
                    "Files you open appear here."
                } else if pane.Filter == "" && location == LocationKind.Trash {
                    "Deleted items appear here."
                } else if pane.Filter == "" {
                    "Create a folder or paste files here."
                } else {
                    "Try a different name or clear the filter."
                },
                p
            )
        }
    }
}
