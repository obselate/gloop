package gloop

import Goo
import System

class PreviewSidebar {
    shared {
        internal func Build(
            browser BrowserController,
            settings AppSettings,
            close Action,
            window Window,
            p Palette
        ) Blob {
            let title = if let entry = browser.SelectedEntry() {
                entry.Name
            } else {
                "Preview"
            }
            return Container{
                Width: Percent(100),
                Height: Percent(100),
                MinWidth: 0,
                MinHeight: 0,
                BackgroundColor: p.Surface,
                Container{
                    Height: 40,
                    FlexShrink: 0,
                    Padding: Edges{Left: 12, Right: 8},
                    Gap: 8,
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(title, p.Text, 13, 600)},
                    Ui.Tool("close", "Close preview", close, window, p),
                },
                Content(browser, settings, p),
            }
        }

        private func Content(browser BrowserController, settings AppSettings, p Palette) Blob {
            if let source = browser.PreviewImage {
                return Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 0,
                    MinHeight: 0,
                    BackgroundColor: p.Background,
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
            if browser.Preview.Kind == "text" {
                return Cell.Mount[TextPreviewInput, TextPreview](
                    nil,
                    TextPreviewInput{
                        Preview: browser.Preview,
                        Palette: p,
                        WordWrap: settings.PreviewWordWrap,
                        LineNumbers: settings.PreviewLineNumbers,
                    }
                )
            }
            if browser.Preview.Kind == "loading" {
                return Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinHeight: 0,
                    BackgroundColor: p.Background,
                    Padding: 12,
                    Ui.Label("Loading…", p.Muted, 12),
                }
            }
            if browser.Preview.Kind == "error" {
                return Ui.Empty("image", "Preview unavailable", browser.Preview.Error, p)
            }
            guard let entry = browser.SelectedEntry() else {
                return Ui.Empty("preview", "Nothing selected", "Select a file to take a closer look.", p)
            }
            let detail = if browser.Preview.Error != "" {
                browser.Preview.Error
            } else if browser.Preview.Text != "Folder" && browser.Preview.Text != FileSystemService.FormatSize(
                entry.Size
            ) {
                browser.Preview.Text
            } else {
                ""
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
                Ui.Icon(FileTable.IconName(entry), p.Accent, 48),
                Ui.Label(entry.Kind, p.Text, 13),
                Metadata(
                    "Size",
                    if entry.IsDirectory {
                        "Folder"
                    } else {
                        FileSystemService.FormatSize(entry.Size)
                    },
                    p
                ),
                Metadata("Modified", entry.Modified.ToString("dd MMM yyyy, HH:mm"), p),
                Text{Content: detail, Color: p.Muted, FontSize: 12, TextWrap: TextWrap.Wrap},
            }
        }

        private func Metadata(label string, value string, p Palette) Blob -> Container{
            FlexDirection: FlexDirection.Row,
            Gap: 8,
            Container{Width: 62, FlexShrink: 0, Ui.Label(label, p.Muted, 11)},
            Ui.Label(value, p.Text, 11),
        }
    }
}
