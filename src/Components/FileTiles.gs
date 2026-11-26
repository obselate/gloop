package gloop

import Goo
import Goo.Widgets.Data
import System
import System.Collections
import System.Collections.Generic
import System.Linq

open class FileTiles : Cell[FileTableInput] {
    private let clicks FileClickState = FileClickState()
    internal const TileWidth float64 = 152
    internal const TileHeight float64 = 172
    internal const Gap float64 = 10
    internal const Padding float64 = 12

    private var clickModifiers KeyModifiers

    protected override func Build(value FileTableInput) Blob {
        let pane = value.Pane
        let p = value.Palette
        let root = Container{
            Handle: value.FocusHandle,
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            MinWidth: 0,
            Focusable: true,
            TabStop: true,
            AutoFocus: value.AutoFocus,
            OnKeyDown: value.OnKey,
            OnTextInput: value.OnText,
            KeyBindings: value.Keys,
            Accessibility: Accessibility{
                Role: AccessibilityRole.List,
                Name: "Files in " + pane.DirectoryPath,
                MultiSelectable: true
            },
        }

        FileTransferUi.Root(root, value, clicks)

        if pane.VisibleEntries.Count == 0 {
            root.Children.Add(FileTable.Empty(pane, p, value.Location, value.Choosing, value.DirectoriesOnly))

            return root
        }

        let grid = VirtualItems(
            FileTileSource(value),
            value.TileWidth,
            TileHeight,
            item -> item.Entry.FullPath,
            item -> Tile(item, value)
        )
        grid.Handle = value.ViewportHandle
        grid.FlexGrow = 1
        grid.FlexBasis = 0
        grid.MinHeight = 0
        grid.MinWidth = 0
        grid.FlexDirection = FlexDirection.Row
        grid.FlexWrap = FlexWrap.Wrap
        grid.Gap = Gap
        grid.Padding = Edges{Left: Padding, Top: Padding, Right: value.ScrollbarInset + 10, Bottom: Padding}
        grid.OverflowX = Overflow.Hidden
        grid.OverflowY = Overflow.Scroll
        grid.ScrollbarY = Ui.ScrollbarStyle(p, value.ScrollbarInset)
        grid.ScrollbarVisibilityY = ScrollbarVisibility.Always

        root.Children.Add(grid)

        return root
    }

    private func Tile(item FileTileItem, value FileTableInput) Blob {
        let entry = item.Entry
        let p = item.Palette
        let selected = item.Selected
        let focused = item.Focused
        let tile = Container{
            Padding: 6,
            Gap: 5,
            BorderRadius: p.CardRadius,
            BorderWidth: 1,
            BorderColor: if selected || item.DropActive {
                p.Accent
            } else {
                Color.Transparent
            },
            BackgroundColor: if selected {
                p.Selection
            } else {
                Color.Transparent
            },
            OutlineWidth: if focused && p.Keyboard && !selected && !item.DropActive {
                1
            } else {
                0
            },
            OutlineColor: p.Accent,
            OutlineOffset: 1,
            HoverStyle: Style{
                BackgroundColor: if selected {
                    p.Selection
                } else {
                    p.Hover
                },
                BorderColor: if selected {
                    p.Accent
                } else {
                    p.Border
                },
            },
            OnPointerDown: e -> {
                if e.Button == PointerButton.Primary {
                    clickModifiers = e.Modifiers
                    value.FocusHandle.Focus()
                }
            },
            OnClick: () -> FileTransferUi.Select(
                entry,
                item.Index,
                value,
                clicks,
                clickModifiers.Ctrl || clickModifiers.Super,
                clickModifiers.Shift
            ),
            Accessibility: Accessibility{Role: AccessibilityRole.ListItem, Name: entry.Name, Selected: selected},
            Cell.Mount[FilePreviewInput, FilePreview](
                "thumbnail",
                FilePreviewInput{
                    Entry: entry,
                    Acquire: value.AcquireThumbnail,
                    Tile: true,
                    Palette: p,
                    WordWrap: item.WordWrap
                }
            ),
            Text{
                Key: "name",
                Content: FileTransferUi.Name(entry),
                FontSize: p.FontSize - 0.5,
                Color: p.Text,
                TextAlign: TextAlign.Center,
                TextWrap: TextWrap.Wrap,
                TextTrimming: TextTrimming.Ellipsis,
                TextMaxLines: 2,
                MinWidth: 0,
            },
            Text{
                Content: value.SizeText(entry),
                FontSize: 10.5,
                Color: p.Muted,
                TextAlign: TextAlign.Center,
                TextWrap: TextWrap.NoWrap,
                TextTrimming: TextTrimming.Ellipsis,
                MinWidth: 0,
            },
        }

        return FileTransferUi.Bind(tile, entry, value, clicks)
    }
}
