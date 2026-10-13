package gloop

import Goo
import Goo.Widgets.Data
import System
import System.Collections
import System.Collections.Generic
import System.Linq

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
                Index: index,
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
