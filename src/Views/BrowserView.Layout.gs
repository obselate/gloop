package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func PaneWidth(index int32) float64 {
        if !Model.Split || BrowsingWidth() < SplitBreakpoint {
            return BrowsingWidth()
        }

        let leadingWidth = SplitSize(BrowsingWidth(), (BrowsingWidth() - 1) * paneRatio, PaneMinimum, PaneMinimum)

        return index == Model.Panes.Count - 1 ? BrowsingWidth() - leadingWidth - 1: leadingWidth
    }

    private func SplitSize(extent float64, requested float64, minimumFirst float64, minimumSecond float64) float64 {
        let available = Math.Max(0, extent - 1)
        let factor = Math.Min(1, available / (minimumFirst + minimumSecond))

        return Math.Clamp(requested, minimumFirst * factor, available - minimumSecond * factor)
    }

    private func WorkspaceWidth() float64 -> width - (
        if width >= PlacesBreakpoint {
            SplitSize(width, placesWidth, PlacesSidebar.MinimumWidth, WorkspaceMinimum) + 1
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
            PaneMinimum,
            PreviewSidebar.MinimumWidth
        )
    } else {
        WorkspaceWidth()
    }

    private func TileColumns(index int32) int32 {
        let list = PaneViewport(index)

        return Math.Max(
            1,
            int32(Math.Floor((list.ContentBox.Width + FileTiles.Gap) / (FileTiles.TileWidth + FileTiles.Gap)))
        )
    }

    private func TileWidth(index int32) float64 {
        let room = paneViews[index].TileViewport.ContentBox.Width

        if room <= 0 {
            return FileTiles.TileWidth
        }

        let columns = Math.Max(1, Math.Floor((room + FileTiles.Gap) / (FileTiles.TileWidth + FileTiles.Gap)))

        return Math.Floor((room - (columns - 1) * FileTiles.Gap) / columns)
    }

    private func PageSize() int32 {
        let list = PaneViewport(Model.ActiveIndex)
        let tiles = settings.ViewMode == ViewMode.Tiles
        let rowHeight = if tiles {
            FileTiles.TileHeight + FileTiles.Gap
        } else {
            FileTable.RowHeight
        }

        return Math.Max(1, int32(Math.Floor(list.ContentBox.Height / rowHeight))) * if tiles {
            TileColumns(Model.ActiveIndex)
        } else {
            1
        }
    }
}
