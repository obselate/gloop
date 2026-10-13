package gloop

import Goo
import System

class PreviewSidebar {
    internal const MinimumWidth float64 = 220

    shared {
        internal func Build(value PreviewSidebarInput, window Window, p Palette) Blob -> Container{
            Width: Percent(100),
            Height: Percent(100),
            MinWidth: 0,
            MinHeight: 0,
            BackgroundColor: p.Preview,
            Container{
                Height: Ui.BarHeight,
                FlexShrink: 0,
                Padding: Edges{Left: 12, Right: 8},
                Gap: 8,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(value.Title, p.Text, 13, 600)},
                Ui.Tool("close", "Close preview", value.Close, window, p),
            },
            Content(value, p),
        }

        private func Content(value PreviewSidebarInput, p Palette) Blob {
            if let source = value.Image {
                return Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    MinHeight: 0,
                    BackgroundColor: p.Canvas,
                    Image{
                        Source: source,
                        Position: PositionType.Absolute,
                        Left: 8,
                        Right: 8,
                        Top: 8,
                        Bottom: 8,
                        Fit: ImageFit.Contain,
                    },
                }
            }
            if value.Preview.Kind == PreviewKind.Text {
                return Cell.Mount[TextPreviewInput, TextPreview](
                    nil,
                    TextPreviewInput{
                        Preview: value.Preview,
                        Palette: p,
                        WordWrap: value.WordWrap,
                        LineNumbers: value.LineNumbers,
                    }
                )
            }
            if value.Preview.Kind == PreviewKind.Loading {
                return Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinHeight: 0,
                    BackgroundColor: p.Canvas,
                    Padding: 12,
                    Ui.Label("Loading…", p.Muted, 12),
                }
            }
            if value.Preview.Kind == PreviewKind.Error {
                return Ui.Empty("image", "Preview unavailable", value.Preview.Error, p)
            }
            guard let entry = value.Entry else {
                return Ui.Empty("preview", "Nothing selected", "Select a file to take a closer look.", p)
            }
            return Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                Padding: 12,
                Gap: 10,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Ui.ScrollbarStyle(p, 8),
                ScrollbarVisibilityY: ScrollbarVisibility.Always,
                Ui.Icon(FileKinds.IconName(entry), p.Accent, 48),
                Ui.Label(entry.Kind, p.Text, 13),
                PropertyRow.Build("Size", value.SizeText, p),
                PropertyRow.Build("Modified", FileEntry.FormatDate(entry.Modified), p),
                Text{Content: value.Detail, Color: p.Muted, FontSize: 12, TextWrap: TextWrap.Wrap},
            }
        }
    }
}
