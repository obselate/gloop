package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

partial class BrowserView {
    private func Toolbar() Blob {
        let pane = Model.ActivePane()
        let p = palette

        return Container{
            Key: "toolbar",
            Height: Ui.BarHeight,
            FlexShrink: 0,
            Padding: Edges{Left: 8},
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 3,
                Ui.Tool("arrow_back", "Back", () -> Invoke("Back"), Host, p, false, !pane.CanBack()),
                Ui.Tool("arrow_forward", "Forward", () -> Invoke("Forward"), Host, p, false, !pane.CanForward()),
                Ui.Tool(
                    "arrow_upward",
                    "Parent folder",
                    () -> Invoke("Parent"),
                    Host,
                    p,
                    false,
                    pane.DirectoryPath == "/"
                ),
            },
            Container{FlexGrow: 1, MinWidth: 0},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 3,
                if width < PlacesBreakpoint {
                    Ui.Tool("bookmarks", "Open bookmarks", () -> Invoke("OpenBookmarks"), Host, p)
                } else {
                    Container{}
                },
                if chooser == nil {
                    Ui.Tool(
                        "bookmark",
                        if settings.IsBookmarked(pane.DirectoryPath) {
                            "Remove bookmark"
                        } else {
                            "Bookmark this folder"
                        },
                        () -> Invoke("ToggleBookmark"),
                        Host,
                        p,
                        settings.IsBookmarked(pane.DirectoryPath),
                        Model.InRecent
                    )
                } else {
                    Container{}
                },
                Ui.Tool("refresh", "Refresh", () -> Invoke("Refresh"), Host, p),
                Ui.Tool("visibility", "Toggle preview", () -> Invoke("TogglePreview"), Host, p, Model.PreviewVisible),
                if chooser == nil {
                    Ui.Tool(
                        "splitscreen_vertical_add",
                        "Toggle split view",
                        () -> Invoke("ToggleSplit"),
                        Host,
                        p,
                        Model.Split
                    )
                } else {
                    Container{}
                },
                Ui.Tool(
                    "visibility_off",
                    "Toggle hidden files",
                    () -> Invoke("ToggleHidden"),
                    Host,
                    p,
                    settings.ShowHidden
                ),
            },
            Container{Width: 1, Height: 20, Margin: Edges{Left: 8}, FlexShrink: 0, BackgroundColor: p.Border},
        }
    }

    private func StatusBar() Blob {
        let p = palette
        let pane = Model.ActivePane()
        let total = pane.VisibleEntries.Count
        let selected = Model.ActivePane().SelectedPaths.Count
        let info = if notice != "" {
            notice
        } else if Model.Status != "" {
            Model.Status
        } else if pane.Loading && total == 0 {
            "Reading folder…"
        } else if selected > 0 {
            let size = Model.ActivePane().SelectedSize()
            selected.ToString() + " of " + total.ToString() +
                " selected" +
                (
                if size < 0 {
                    ""
                } else {
                    " · " + FileSystemService.FormatSize(size)
                }
            )
        } else if total == 1 {
            "1 item"
        } else {
            total.ToString() + " items"
        }

        let bar = Container{
            Height: 26,
            Key: "status",
            FlexShrink: 0,
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Padding: Edges{Left: 12, Right: 10},
            Gap: 14,
            BorderWidth: Edges{Top: p.Glass ? 0: 1},
            BorderColor: p.Border,
            BackgroundColor: p.Bar,
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(info, p.Muted, 11)},
        }

        if let space = SpaceStatus() {
            bar.Children.Insert(1, space)
        }

        return bar
    }
}
