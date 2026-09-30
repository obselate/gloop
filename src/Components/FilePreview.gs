package gloop

import Goo
import System

internal data struct FilePreviewInput {
    var Entry FileEntry
    var Service ThumbnailService
    var Tile bool
    var Palette Palette
    var WordWrap bool
}

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
            lease = value.Service.Acquire(entry, 160, () -> Rebuild())
        }
        let data = lease?.Data
        let canvas = Container{
            Width: 22,
            Height: if value.Tile {
                100
            } else {
                22
            },
            MinWidth: 0,
            FlexShrink: 0,
            AlignItems: AlignItems.Center,
            JustifyContent: JustifyContent.Center,
            Overflow: Overflow.Hidden,
            BorderRadius: if value.Tile {
                4
            } else {
                2
            },
            BackgroundColor: if value.Tile && !entry.IsDirectory {
                p.Background
            } else {
                Color.Transparent
            },
            Accessibility: Accessibility{Hidden: true},
        }
        if value.Tile {
            canvas.Width = Percent(100)
        }
        if let source = data?.Source {
            canvas.Children.Add(
                Image{Source: source, Fit: ImageFit.Contain, Width: Percent(100), Height: Percent(100),}
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
                    LineHeight: 1.2,
                    Color: p.Muted,
                    TextWrap: value.WordWrap ? TextWrap.Wrap: TextWrap.NoWrap,
                    TextTrimming: TextTrimming.Ellipsis,
                    TextMaxLines: 7,
                }
            )
        } else {
            canvas.Children.Add(
                Ui.Icon(
                    FileTable.IconName(entry),
                    if entry.IsDirectory {
                        p.Accent
                    } else {
                        p.Muted
                    },
                    if value.Tile {
                        48
                    } else {
                        18
                    }
                )
            )
        }
        return canvas
    }
}
