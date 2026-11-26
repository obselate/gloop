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
                Ui.Tool(
                    "arrow_back",
                    "Back",
                    () -> Invoke("Back"),
                    Host,
                    p,
                    false,
                    !pane.CanBack(),
                    shortcut: settings.ShortcutFor("Back")
                ),
                Ui.Tool(
                    "arrow_forward",
                    "Forward",
                    () -> Invoke("Forward"),
                    Host,
                    p,
                    false,
                    !pane.CanForward(),
                    shortcut: settings.ShortcutFor("Forward")
                ),
                Ui.Tool(
                    "arrow_upward",
                    "Parent folder",
                    () -> Invoke("Parent"),
                    Host,
                    p,
                    false,
                    pane.DirectoryPath == "/",
                    shortcut: settings.ShortcutFor("Parent")
                ),
            },
            Container{FlexGrow: 1, MinWidth: 0},
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 3,
                if width < PlacesBreakpoint {
                    Ui.Tool(
                        "bookmarks",
                        "Open bookmarks",
                        () -> Invoke("OpenBookmarks"),
                        Host,
                        p,
                        shortcut: settings.ShortcutFor("OpenBookmarks")
                    )
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
                        Model.InRecent,
                        shortcut: settings.ShortcutFor("ToggleBookmark")
                    )
                } else {
                    Container{}
                },
                Ui.Tool(
                    "refresh",
                    "Refresh",
                    () -> Invoke("Refresh"),
                    Host,
                    p,
                    shortcut: settings.ShortcutFor("Refresh")
                ),
                Ui.Tool(
                    "visibility",
                    "Toggle preview",
                    () -> Invoke("TogglePreview"),
                    Host,
                    p,
                    Model.PreviewVisible,
                    shortcut: settings.ShortcutFor("TogglePreview")
                ),
                if chooser == nil {
                    Ui.Tool(
                        "splitscreen_vertical_add",
                        "Toggle split view",
                        () -> Invoke("ToggleSplit"),
                        Host,
                        p,
                        Model.Split,
                        shortcut: settings.ShortcutFor("ToggleSplit")
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
                    settings.ShowHidden,
                    shortcut: settings.ShortcutFor("ToggleHidden")
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
            BorderWidth: Edges{Top: 1},
            BorderColor: p.Border,
            BackgroundColor: p.Canvas,
            Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(info, p.Muted, 11)},
        }

        if let space = SpaceStatus() {
            bar.Children.Insert(1, space)
        }

        return bar
    }
}
