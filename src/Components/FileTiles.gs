package gloop

import Goo
import System
import System.Collections
import System.Collections.Generic
import System.Linq

internal data struct FileTileItem {
    var Entry FileEntry
    var Selected bool
    var Focused bool
    var DropActive bool
    var Palette Palette
    var WordWrap bool
}

class FileTileSource : IReadOnlyList[FileTileItem] {
    private let value FileTableInput
    private let entries List[FileEntry]

    internal init(value FileTableInput) {
        this.value = value
        entries = value.Pane.VisibleEntries
    }

    /// Gets the number of items in this view snapshot.
    public prop Count int32 {
        get -> entries.Count
    }

    /// Gets the immutable render state for one visible item.
    public prop this[index int32]FileTileItem {
        get {
            let pane = value.Pane
            let entry = entries[index]
            return FileTileItem{
                Entry: entry,
                Selected: pane.SelectedPaths.Contains(entry.FullPath),
                Focused: value.Active && pane.Selected == index,
                DropActive: value.DropPath == entry.FullPath,
                Palette: value.Palette,
                WordWrap: value.WordWrap,
            }
        }
    }

    /// Enumerates the current rendered item values.
    public func GetEnumerator() IEnumerator[FileTileItem] -> Enumerable
        .Range(0, Count)
        .Select(index -> this[index])
        .GetEnumerator()

    private func (IEnumerable) GetEnumerator() IEnumerator -> GetEnumerator()
}

open class FileTiles : Cell[FileTableInput] {
    private let clicks FileClickState = FileClickState()
    internal const TileWidth float64 = 144
    internal const TileHeight float64 = 156
    internal const Gap float64 = 8
    private var entries List[FileEntry]?
    private var indices Dictionary[string, int32] = Dictionary[string, int32](StringComparer.Ordinal)
    private var clickModifiers KeyModifiers

    protected override func Build(value FileTableInput) Blob {
        let pane = value.Pane
        let p = value.Palette
        if !Object.ReferenceEquals(entries, pane.VisibleEntries) {
            entries = pane.VisibleEntries
            indices = Dictionary[string, int32](StringComparer.Ordinal)
            for index in 0 ... pane.VisibleEntries.Count {
                indices[pane.VisibleEntries[index].FullPath] = index
            }
        }
        let root = Container{
            Handle: value.FocusHandle,
            FlexGrow: 1,
            FlexBasis: 0,
            MinHeight: 0,
            MinWidth: 0,
            Focusable: true,
            TabStop: true,
            AutoFocus: value.Active,
            OnKeyDown: value.OnKey,
            OnTextInput: value.OnText,
            KeyBindings: value.Keys,
            DropTarget: value.DropTarget(pane.DirectoryPath),
            OutlineWidth: value.DropPath == pane.DirectoryPath ? 1: 0,
            OutlineColor: p.Accent,
            OutlineOffset: -1,
            OnPointerDown: e -> {
                if e.Button == PointerButton.Primary && !e.IsFromInteractiveChild
                && !e.Modifiers.Ctrl && !e.Modifiers.Shift && !e.Modifiers.Super {
                    value.OnClear()
                }
            },
            Accessibility: Accessibility{
                Role: AccessibilityRole.List,
                Name: "Files in " + pane.DirectoryPath,
                MultiSelectable: true
            },
        }
        if pane.VisibleEntries.Count == 0 {
            root.Children.Add(FileTable.Empty(pane, p))
            return root
        }
        let grid = Virtual(
            FileTileSource(value),
            TileWidth,
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
        grid.Padding = 12
        grid.OverflowX = Overflow.Hidden
        grid.OverflowY = Overflow.Scroll
        grid.ScrollbarY = Ui.ScrollbarStyle(p)
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
            BorderRadius: 5,
            BackgroundColor: if selected {
                p.Selection
            } else {
                Color.Transparent
            },
            OutlineWidth: if focused || item.DropActive {
                1
            } else {
                0
            },
            OutlineColor: p.Accent,
            OutlineOffset: -1,
            Hover: Style{
                BackgroundColor: if selected {
                    p.Selection
                } else {
                    p.Surface
                }
            },
            OnPointerDown: e -> {
                if e.Button == PointerButton.Primary {
                    clickModifiers = e.Modifiers
                    value.FocusHandle.Focus()
                }
            },
            OnClick: () -> FileTransferUi.Select(
                entry,
                indices[entry.FullPath],
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
                    Service: value.Thumbnails,
                    Tile: true,
                    Palette: p,
                    WordWrap: item.WordWrap
                }
            ),
            Text{
                Key: "name",
                Content: entry.Name + if entry.IsSymlink {
                    " ↗"
                } else {
                    ""
                },
                Height: 34,
                FontSize: 13,
                Color: p.Text,
                TextWrap: TextWrap.Wrap,
                TextTrimming: TextTrimming.Ellipsis,
                TextMaxLines: 2,
                MinWidth: 0,
            },
        }
        return FileTransferUi.Bind(tile, entry, value, clicks)
    }
}
