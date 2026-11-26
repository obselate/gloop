package gloop

import Goo
import System

class PreviewSidebar {
    internal const MinimumWidth float64 = 220

    shared {
        internal func Build(value PreviewSidebarInput, window Window, p Palette) Blob {
            let header = Container{
                Height: Ui.BarHeight + 1,
                FlexShrink: 0,
                Padding: Edges{Left: 12, Right: 8},
                Gap: 4,
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                BorderWidth: Edges{Bottom: 1},
                BorderColor: p.Border,
                if let entry = value.Entry {
                    Ui.FileIcon(FileKinds.IconName(entry), p, 16)
                } else {
                    Ui.Icon("preview", p.Muted, 16)
                },
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    Margin: Edges{Left: 4},
                    Ui.Label(value.Title, p.Text, 13, 600),
                },
            }

            if value.IsText {
                header.Children.Add(
                    Ui.Tool(
                        "wrap_text",
                        "Toggle word wrap",
                        value.OnToggleWordWrap,
                        window,
                        p,
                        value.WordWrap,
                        size: 26,
                        iconSize: 16
                    )
                )
            }

            if value.Entry != nil {
                header.Children.Add(
                    Ui.Tool(
                        "open_in_new",
                        "Open",
                        value.OnOpen,
                        window,
                        p,
                        size: 26,
                        iconSize: 16,
                        shortcut: value.OpenShortcut
                    )
                )
                header.Children.Add(
                    Ui.Tool(
                        "link",
                        "Copy path",
                        value.OnCopyPath,
                        window,
                        p,
                        size: 26,
                        iconSize: 16,
                        shortcut: value.CopyPathShortcut
                    )
                )
            }

            header.Children.Add(
                Ui.Tool(
                    "close",
                    "Close preview",
                    value.Close,
                    window,
                    p,
                    size: 26,
                    iconSize: 18,
                    shortcut: value.CloseShortcut
                )
            )

            return Container{
                Width: Percent(100),
                Height: Percent(100),
                MinWidth: 0,
                MinHeight: 0,
                BackgroundColor: p.Preview,
                header,
                Content(value, p),
            }
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
                        KeepPreviousWhilePending: true,
                    },
                }
            }

            if let vector = value.Preview.Vector {
                return Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    MinHeight: 0,
                    BackgroundColor: p.Canvas,
                    Container{
                        Position: PositionType.Absolute,
                        Left: 8,
                        Right: 8,
                        Top: 8,
                        Bottom: 8,
                        Sized(
                            size -> {
                                let scale = Math.Max(
                                    0.0,
                                    Math.Min(size.Width / vector.ViewBoxWidth, size.Height / vector.ViewBoxHeight)
                                )
                                return Container{
                                    Width: Percent(100),
                                    Height: Percent(100),
                                    AlignItems: AlignItems.Center,
                                    JustifyContent: JustifyContent.Center,
                                    Container{
                                        Width: vector.ViewBoxWidth * scale,
                                        Height: vector.ViewBoxHeight * scale,
                                        MinWidth: 0,
                                        MinHeight: 0,
                                        FlexShrink: 0,
                                        vector.Render(),
                                    },
                                }
                            }
                        ){.Width: Percent(100), .Height: Percent(100), .MinWidth: 0, .MinHeight: 0},
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
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Gap: 8,
                    Ui.Icon("hourglass_empty", p.Muted, 24),
                    Ui.Label("Loading preview…", p.Muted, 12),
                }
            }

            if value.Preview.Kind == PreviewKind.Error {
                return Ui.Empty("image", "Preview unavailable", value.Preview.Error, p)
            }

            guard let entry = value.Entry else {
                return Ui.Empty("preview", "Nothing selected", "Select a file to take a closer look.", p)
            }

            let meta = Container{
                FlexGrow: 1,
                FlexBasis: 0,
                MinHeight: 0,
                Padding: 14,
                Gap: 10,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Ui.ScrollbarStyle(p, 8),
                ScrollbarVisibilityY: ScrollbarVisibility.Always,
                Container{
                    Width: 64,
                    Height: 64,
                    BorderRadius: p.CardRadius,
                    BackgroundColor: p.SubtleSurface,
                    BorderWidth: 1,
                    BorderColor: p.Border,
                    AlignItems: AlignItems.Center,
                    JustifyContent: JustifyContent.Center,
                    Ui.FileIcon(FileKinds.IconName(entry), p, 34),
                },
                Ui.Label(entry.Kind, p.Text, 13, 600),
                PropertyRow.Build("Size", value.SizeText, p),
                PropertyRow.Build("Modified", FileEntry.FormatDate(entry.Modified), p),
            }

            if entry.Created != DateTime.MinValue {
                meta.Children.Add(PropertyRow.Build("Created", FileEntry.FormatDate(entry.Created), p))
            }

            if entry.Permissions != "" {
                meta.Children.Add(PropertyRow.Build("Permissions", entry.Permissions, p))
            }

            if value.Detail != "" {
                meta.Children.Add(Text{Content: value.Detail, Color: p.Muted, FontSize: 12, TextWrap: TextWrap.Wrap})
            }

            return meta
        }
    }
}
