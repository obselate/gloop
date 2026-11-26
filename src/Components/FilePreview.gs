package gloop

import Goo
import System

open class FilePreview : Cell[FilePreviewInput], IDisposable {
    private var lease ThumbnailLease?
    private var path string = ""
    private var size int64
    private var modified int64

    /// Releases this entry's visible thumbnail demand.
    public func Dispose() {
        lease?.Dispose()
        lease = nil
    }

    protected override func Build(value FilePreviewInput) Blob {
        let entry = value.Entry
        let p = value.Palette

        if path != entry.FullPath || size != entry.Size || modified != entry.Modified.Ticks {
            Dispose()
            path = entry.FullPath
            size = entry.Size
            modified = entry.Modified.Ticks
        }

        if !entry.IsDirectory && lease == nil {
            lease = value.Acquire(entry, value.Tile ? 256: 48, () -> Rebuild())
        }

        let data = lease?.Data
        let innerRadius = Math.Max(2.0, p.CardRadius - 6.0)
        let canvas = Container{
            Width: p.RowIconSize + 4,
            Height: if value.Tile {
                104
            } else {
                p.RowIconSize + 4
            },
            MinWidth: 0,
            FlexShrink: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Overflow: Overflow.Hidden,
            BorderRadius: if value.Tile {
                innerRadius
            } else {
                2
            },
            BorderWidth: value.Tile && !entry.IsDirectory ? 1: 0,
            BorderColor: value.Tile && !entry.IsDirectory ? p.Border.WithAlpha(.55): Color.Transparent,
            BackgroundColor: if value.Tile && !entry.IsDirectory {
                p.SubtleSurface
            } else {
                Color.Transparent
            },
            Accessibility: Accessibility{Hidden: true},
        }

        if value.Tile {
            canvas.Width = Percent(100)
        }

        if let source = data?.Source {
            canvas.Padding = value.Tile ? 2: 0
            canvas.Children.Add(
                Image{
                    Source: source,
                    Fit: ImageFit.Contain,
                    Width: Percent(100),
                    Height: Percent(100),
                    KeepPreviousWhilePending: true,
                }
            )
        } else if value.Tile && data?.Kind == "text" {
            canvas.Children.Add(
                Text{
                    Content: data?.Text ?? "",
                    Width: Percent(100),
                    Height: Percent(100),
                    Padding: 8,
                    FontFamily: "monospace",
                    FontSize: 10,
                    LineHeight: 1.25,
                    Color: p.Muted,
                    TextWrap: value.WordWrap ? TextWrap.Wrap: TextWrap.NoWrap,
                    TextTrimming: TextTrimming.Ellipsis,
                    TextMaxLines: 7,
                }
            )
        } else {
            canvas.Children.Add(Ui.FileIcon(FileKinds.IconName(entry), p, value.Tile ? 48: p.RowIconSize))
        }

        return canvas
    }
}
