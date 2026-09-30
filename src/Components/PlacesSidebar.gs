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
            showPreferences bool = true
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
            places.Add(Ui.Section("BOOKMARKS", p))
            if bookmarks.Count == 0 {
                places.Add(
                    Container{
                        Padding: Edges{Left: 12, Right: 8, Bottom: 6},
                        Ui.Label(bookmarkKey == "" ? "No bookmarks": bookmarkKey + " to add a folder", p.Muted, 11),
                    }
                )
            }
            for bookmark in bookmarks {
                let name = if bookmark == "/" {
                    "File system"
                } else {
                    Path.GetFileName(bookmark)
                }
                places.Add(Bookmark(bookmark, name, path, navigate, window, p, PortalPlacement.Right, drop, dropPath))
            }
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
            icon string = "bookmark"
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
                    Target: Place(icon, label, path, current, navigate, p, drop, dropPath),
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
            dropPath string = ""
        ) Blob -> Cell
            .Mount[SidebarLinkInput, SidebarLink](
            nil,
            SidebarLinkInput{
                Icon: icon,
                Label: name,
                Active: current == destination,
                Action: () -> navigate(destination),
                DropTarget: drop?.Invoke(destination),
                DropActive: destination != "" && destination == dropPath,
                Palette: p,
            }
        )
    }
}
