package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import System
import System.Collections.Generic

open class FileTable : Cell[FileTableInput] {
    private let clicks FileClickState = FileClickState()
    private const NameMinimum float64 = 150
    private const ModifiedWidth float64 = 136
    private const CreatedWidth float64 = 136
    private const TypeWidth float64 = 104
    private const ExtensionWidth float64 = 76
    private const PermissionsWidth float64 = 96
    private const SizeWidth float64 = 88
    private var entries List[FileEntry]?
    private var rows[]DataGridRow = []DataGridRow{}
    private var indices Dictionary[string, int32] = Dictionary[string, int32]()
    private var cachedColumns[]?DataGridColumn
    private var cachedColumnWidth float64 = -1
    private var cachedColumnMask int32 = -1

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

        UpdateRows(pane)

        let scrollbarX = Ui.ScrollbarStyle(p)
        let scrollbarY = Ui.ScrollbarStyle(p, value.ScrollbarInset)
        let selected = [pane.SelectedPaths.Count]string
        pane.SelectedPaths.CopyTo(selected)

        let grid = DataGridInput{
            Rows: rows,
            ColumnWidths: value.ColumnWidths,
            FitColumnsToViewport: true,
            OnFittedColumnWidthsChange: value.OnFittedColumnWidthsChange,
            RootHandle: value.FocusHandle,
            ViewportHandle: value.ViewportHandle,
            UseDefaultKeyboard: false,
            OnTextInput: value.OnText,
            OnKeyDown: value.OnKey,
            ScrollbarX: scrollbarX,
            ScrollbarVisibilityX: ScrollbarVisibility.Auto,
            ScrollbarY: scrollbarY,
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
            RowHeight: p.RowHeight,
            HeaderHeight: p.HeaderHeight,
            BackgroundColor: p.Canvas,
            TextColor: p.Text,
            SelectedColor: value.Active ? p.Selection: p.Hover,
            FocusColor: p.Keyboard ? p.Accent: Color.Transparent,
            AccessibilityName: "Files in " + pane.DirectoryPath,
            HeaderStyle: Style{BackgroundColor: p.Canvas, BorderWidth: Edges{Bottom: 1}, BorderColor: p.Border},
            ConfigureResizeHandle: (_, _, handle) -> {
                handle.BorderWidth = 0
                handle.AlignItems = AlignItems.Center
                handle.JustifyContent = JustifyContent.Center
                handle.HoverStyle = Style{BackgroundColor: p.Accent.WithAlpha(.25)}
                handle.FocusStyle = p.Ring(-1)
                handle.Children.Add(Container{Width: 1, Height: Percent(50), BackgroundColor: p.Border})
            },
            CreateHeader: (_, column, _) -> BuildHeader(column, value),
            CreateCell: (_, row, column, _) -> CellContent(
                pane.VisibleEntries[indices[(row.Id ?? "")]],
                (column.Id ?? ""),
                pane.SelectedPaths.Contains(row.Id ?? ""),
                value,
                p
            ),
            ConfigureRow: (_, row, root) -> {
                let rowId = row.Id ?? ""
                let rowIndex = indices.GetValueOrDefault(rowId, -1)
                let selectedRow = pane.SelectedPaths.Contains(rowId)
                let focused = pane.Selected >= 0 && pane.VisibleEntries[pane.Selected].FullPath == row.Id
                root.OutlineWidth = if focused && value.Active && p.Keyboard {
                    1
                } else {
                    0
                }
                root.OutlineColor = p.Accent
                root.BorderRadius = p.ControlRadius
                if !selectedRow && p.AlternatingRows && rowIndex >= 0 && rowIndex % 2 == 1 {
                    root.BackgroundColor = p.RowStripe
                }
                root.HoverStyle = Style{
                    BackgroundColor: if selectedRow {
                        p.Selection
                    } else {
                        p.Hover
                    }
                }
                FileTransferUi.Bind(root, pane.VisibleEntries[indices[rowId]], value, clicks)
            },
        }

        return Sized(
            size -> {
                let scrolls = pane.VisibleEntries.Count * p.RowHeight >
                size.Height - p.HeaderHeight - scrollbarX.Thickness - scrollbarX.Inset
                let right = scrolls ? 0: Ui.CardInset
                let gutter = scrolls ? scrollbarY.Thickness + scrollbarY.Inset: 0

                return Cell.Mount[DataGridInput, DataGrid](
                    "grid",
                    grid with{
                        Columns = BuildColumns(
                            value,
                            size.Width - Ui.CardInset - right - gutter - 2 * p.WidgetTheme.RowInset
                        ),
                        ScrollbarVisibilityY = scrolls ? ScrollbarVisibility.Always: ScrollbarVisibility.Hidden,
                        ConfigureRoot = (_, root) -> ConfigureRoot(root, value, right),
                    }
                )
            }
        ){.FlexGrow: 1, .FlexBasis: 0, .MinWidth: 0, .MinHeight: 0}
    }

    private func UpdateRows(pane BrowserPane) {
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
    }

    private func BuildColumns(value FileTableInput, width float64)[]DataGridColumn {
        let mask = (value.ShowModified ? 1: 0) |
        (value.ShowCreated ? 2: 0) |
        (value.ShowType ? 4: 0) |
        (value.ShowExtension ? 8: 0) |
        (value.ShowPermissions ? 16: 0) |
        (value.ShowSize ? 32: 0)

        if let existing = cachedColumns {
            if cachedColumnMask == mask && Math.Abs(cachedColumnWidth - width) < 0.5 {
                return existing
            }
        }

        let columns = List[DataGridColumn]()
        columns.Add(DataGridColumn{Id: "name", Label: "Name", Minimum: NameMinimum, Sortable: true})

        var used = NameMinimum

        if value.ShowModified && used + ModifiedWidth <= width {
            columns.Add(
                DataGridColumn{Id: "modified", Label: "Modified", Width: ModifiedWidth, Minimum: 90, Sortable: true}
            )
            used += ModifiedWidth
        }

        if value.ShowCreated && used + CreatedWidth <= width {
            columns.Add(
                DataGridColumn{Id: "created", Label: "Created", Width: CreatedWidth, Minimum: 90, Sortable: true}
            )
            used += CreatedWidth
        }

        if value.ShowType && used + TypeWidth <= width {
            columns.Add(DataGridColumn{Id: "kind", Label: "Type", Width: TypeWidth, Minimum: 70, Sortable: true})
            used += TypeWidth
        }

        if value.ShowExtension && used + ExtensionWidth <= width {
            columns.Add(
                DataGridColumn{Id: "extension", Label: "Ext", Width: ExtensionWidth, Minimum: 54, Sortable: true}
            )
            used += ExtensionWidth
        }

        if value.ShowPermissions && used + PermissionsWidth <= width {
            columns.Add(
                DataGridColumn{
                    Id: "permissions",
                    Label: "Permissions",
                    Width: PermissionsWidth,
                    Minimum: 82,
                    Sortable: true
                }
            )
            used += PermissionsWidth
        }

        if value.ShowSize && used + SizeWidth <= width {
            columns.Add(DataGridColumn{Id: "size", Label: "Size", Width: SizeWidth, Minimum: 60, Sortable: true})
        }

        let built = columns.ToArray()
        cachedColumns = built
        cachedColumnMask = mask
        cachedColumnWidth = width
        return built
    }

    private func ConfigureRoot(root Container, value FileTableInput, right float64) {
        root.FlexGrow = 1
        root.FlexBasis = 0
        root.BorderWidth = 0
        root.BorderRadius = 0
        let rowInset = value.Palette.WidgetTheme.RowInset
        root.Padding = Edges{Left: Ui.CardInset + rowInset, Right: right + rowInset}
        root.AutoFocus = value.AutoFocus
        root.KeyBindings = value.Keys

        FileTransferUi.Root(root, value, clicks)
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
            let label = Ui.Label(FileTransferUi.Name(entry), p.Text, p.FontSize)
            label.Key = "name"

            let row = Container{MinWidth: 0, FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 6,}

            if !p.Fluent {
                row.Children.Add(
                    Container{
                        Width: 3,
                        Height: Math.Max(12, p.RowHeight - 14),
                        FlexShrink: 0,
                        BorderRadius: 2,
                        BackgroundColor: selected && value.Active ? p.Accent: Color.Transparent,
                    }
                )
            }

            row.Children.Add(
                Cell.Mount[FilePreviewInput, FilePreview](
                    "thumbnail",
                    FilePreviewInput{Entry: entry, Acquire: value.AcquireThumbnail, Tile: false, Palette: p}
                )
            )
            row.Children.Add(label)

            return row
        }

        let today = (column == "modified" && entry.Modified.Date == DateTime.Today)
        || (column == "created" && entry.Created.Date == DateTime.Today)
        let text = switch column {
            case "modified": FileEntry.FormatDate(entry.Modified, compact: true)
            case "created": entry.Created == DateTime.MinValue ? "—": FileEntry.FormatDate(entry.Created, compact: true)
            case "kind": entry.Kind
            case "extension": entry.ExtensionText()
            case "permissions": entry.Permissions != "" ? entry.Permissions: "—"
            default: value.SizeText(entry)
        }
        let label = Ui.Label(text, selected || today ? p.Text: p.Muted, p.SecondaryFontSize)
        if column == "permissions" {
            label.FontFamily = "monospace"
            label.FontSize = p.SecondaryFontSize - 0.5
        }

        return Container{
            MinWidth: 0,
            AlignItems: if column == "size" {
                AlignItems.FlexEnd
            } else {
                AlignItems.FlexStart
            },
            label,
        }
    }

    shared {
        private func ColumnKind(id string) SortColumn -> switch id {
            case "modified": SortColumn.Modified
            case "created": SortColumn.Created
            case "kind": SortColumn.Kind
            case "extension": SortColumn.Extension
            case "permissions": SortColumn.Permissions
            case "size": SortColumn.Size
            default: SortColumn.Name
        }

        private func ColumnId(column SortColumn) string -> switch column {
            case SortColumn.Modified: "modified"
            case SortColumn.Created: "created"
            case SortColumn.Kind: "kind"
            case SortColumn.Extension: "extension"
            case SortColumn.Permissions: "permissions"
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
