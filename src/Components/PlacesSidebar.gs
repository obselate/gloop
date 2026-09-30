package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

class PlacesSidebar {
    shared {
        internal func Build(
            path string,
            navigate Action[string],
            settings Action,
            bookmarks IReadOnlyList[string],
            bookmarkKey string,
            window Window,
            p Palette,
            drop Func[string, DropTarget]? = nil,
            dropPath string = "",
            showPreferences bool = true,
            bookmarkDrop Func[int32, DropTarget]? = nil,
            bookmarkDropIndex int32 = -1,
            bookmarkMenu Action[string, Point]? = nil,
            bookmarkMenuKey Action[string, KeyEvent, Point]? = nil
        ) Blob {
            let home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            let places = List[Blob]()
            places.Add(Ui.Section("PLACES", p))
            places.Add(Place("home", "Home", home, path, navigate, p, drop, dropPath))
            for name in[]string{"Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"} {
                let location = Path.Combine(home, name)
                if Directory.Exists(location) {
                    let icon = switch name {
                        case "Desktop": "desktop_windows"
                        case "Documents": "description"
                        case "Downloads": "download"
                        case "Pictures": "image"
                        case "Music": "music_note"
                        default: "movie"
                    }
                    places.Add(Place(icon, name, location, path, navigate, p, drop, dropPath))
                }
            }
            let saved = Container{
                FlexShrink: 0,
                DropTarget: bookmarkDrop?.Invoke(bookmarks.Count),
                Ui.Section("BOOKMARKS", p),
            }
            if bookmarks.Count == 0 {
                saved.Children.Add(
                    Container{
                        MinHeight: 32,
                        Padding: Edges{Left: 12, Right: 8, Bottom: 6},
                        BackgroundColor: bookmarkDropIndex == 0 ? p.Selection: Color.Transparent,
                        Accessibility: Accessibility{Name: "Add bookmarks"},
                        Text{
                            Content: bookmarkKey == "" ? "No bookmarks": "Drop folders here or " + bookmarkKey,
                            Color: p.Muted,
                            FontSize: 11,
                            TextWrap: TextWrap.Wrap,
                        },
                    }
                )
            }
            for index in 0 ... bookmarks.Count {
                let bookmark = bookmarks[index]
                let name = if bookmark == "/" {
                    "File system"
                } else {
                    Path.GetFileName(bookmark)
                }
                if let insert = bookmarkDrop {
                    saved.Children.Add(
                        DropInsertion.Build(
                            insert(index),
                            bookmarkDropIndex == index,
                            "Insert bookmark at position " + (index + 1).ToString(),
                            p
                        )
                    )
                }
                var openMenu Action[Point]? = nil
                var openMenuKey Action[KeyEvent, Point]? = nil
                if let menu = bookmarkMenu {
                    openMenu = point -> menu(bookmark, point)
                }
                if let menuKey = bookmarkMenuKey {
                    openMenuKey = (e, point) -> menuKey(bookmark, e, point)
                }
                saved.Children.Add(
                    Bookmark(
                        bookmark,
                        name,
                        path,
                        navigate,
                        window,
                        p,
                        PortalPlacement.Right,
                        drop,
                        dropPath,
                        contextMenu: openMenu,
                        contextMenuKey: openMenuKey
                    )
                )
            }
            if bookmarks.Count > 0 {
                if let insert = bookmarkDrop {
                    saved.Children.Add(
                        DropInsertion.Build(
                            insert(bookmarks.Count),
                            bookmarkDropIndex == bookmarks.Count,
                            "Insert bookmark at position " + (bookmarks.Count + 1).ToString(),
                            p
                        )
                    )
                }
            }
            places.Add(saved)
            places.Add(Ui.Section("THIS COMPUTER", p))
            places.Add(Place("hard_drive", "File system", "/", path, navigate, p, drop, dropPath))
            return Container{
                Width: Percent(100),
                Height: Percent(100),
                MinWidth: 0,
                MinHeight: 0,
                BackgroundColor: p.Surface,
                Padding: Edges{Left: 6, Right: 6},
                Container{
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinHeight: 0,
                    OverflowY: Overflow.Scroll,
                    ScrollbarY: Ui.ScrollbarStyle(p),
                    ScrollbarVisibilityY: ScrollbarVisibility.Always,
                    Children: places.ToArray()
                },
                if showPreferences {
                    Container{
                        Height: 44,
                        FlexShrink: 0,
                        JustifyContent: JustifyContent.Center,
                        Place("settings", "Preferences", "", "not-selected", (_) -> settings(), p),
                    }
                } else {
                    Container{}
                },
            }
        }

        internal func Bookmark(
            path string,
            label string,
            current string,
            navigate Action[string],
            window Window,
            p Palette,
            placement PortalPlacement = PortalPlacement.Right,
            drop Func[string, DropTarget]? = nil,
            dropPath string = "",
            icon string = "bookmark",
            contextMenu Action[Point]? = nil,
            contextMenuKey Action[KeyEvent, Point]? = nil
        ) Blob -> Container{
            FlexShrink: 0,
            Cell.Mount[TooltipInput, Tooltip](
                path,
                TooltipInput{
                    Window: window,
                    Text: path,
                    Placement: placement,
                    BubbleStyle: Style{BackgroundColor: p.Surface, BorderColor: p.Border, BorderWidth: 1, Padding: 8,},
                    Content: Text{Content: path, Color: p.Text, FontSize: 11, MaxWidth: 320, TextWrap: TextWrap.Wrap,},
                    Target: Place(icon, label, path, current, navigate, p, drop, dropPath, contextMenu, contextMenuKey),
                }
            ),
        }

        private func Place(
            icon string,
            name string,
            destination string,
            current string,
            navigate Action[string],
            p Palette,
            drop Func[string, DropTarget]? = nil,
            dropPath string = "",
            contextMenu Action[Point]? = nil,
            contextMenuKey Action[KeyEvent, Point]? = nil
        ) Blob -> Cell
            .Mount[SidebarLinkInput, SidebarLink](
            nil,
            SidebarLinkInput{
                Icon: icon,
                Label: name,
                Active: current == destination,
                Action: () -> navigate(destination),
                OnContextMenu: contextMenu,
                OnContextMenuKey: contextMenuKey,
                DropTarget: drop?.Invoke(destination),
                DropActive: destination != "" && destination == dropPath,
                Palette: p,
            }
        )
    }
}
