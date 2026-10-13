package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

class PlacesSidebar {
    internal const MinimumWidth float64 = 144

    shared {
        internal func Build(
            path string,
            navigate Action[string],
            settings Action,
            bookmarks IReadOnlyList[string],
            bookmarkKey string,
            window Window,
            p Palette,
            standardPlaces IReadOnlyList[KeyValuePair[string, string]],
            drop Func[string, DropTarget]? = nil,
            dropPath string = "",
            showPreferences bool = true,
            bookmarkDrop Func[int32, DropTarget]? = nil,
            bookmarkDropIndex int32 = -1,
            bookmarkMenu Action[string, Point]? = nil,
            bookmarkMenuKey Action[string, KeyEvent, Point]? = nil,
            volumes IReadOnlyList[Volume]? = nil,
            openVolume Action[Volume]? = nil,
            ejectVolume Action[Volume]? = nil,
            trashPath string = "",
            trashCount int32 = 0,
            showVirtual bool = true
        ) Blob {
            let places = List[Blob]()
            BuildPlaces(places, path, navigate, p, standardPlaces, drop, dropPath, showVirtual, trashPath, trashCount)
            BuildBookmarks(
                places,
                path,
                navigate,
                bookmarks,
                bookmarkKey,
                window,
                p,
                drop,
                dropPath,
                bookmarkDrop,
                bookmarkDropIndex,
                bookmarkMenu,
                bookmarkMenuKey
            )
            BuildDevices(places, path, navigate, window, p, drop, dropPath, volumes, openVolume, ejectVolume)
            return Container{
                Width: Percent(100),
                Height: Percent(100),
                MinWidth: 0,
                MinHeight: 0,
                BackgroundColor: p.Sidebar,
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

        private func BuildPlaces(
            places List[Blob],
            path string,
            navigate Action[string],
            p Palette,
            standardPlaces IReadOnlyList[KeyValuePair[string, string]],
            drop Func[string, DropTarget]?,
            dropPath string,
            showVirtual bool,
            trashPath string,
            trashCount int32
        ) {
            places.Add(Ui.Section("PLACES", p))
            for place in standardPlaces {
                let icon = switch place.Key {
                    case "Home": "home"
                    case "Desktop": "desktop_windows"
                    case "Documents": "description"
                    case "Downloads": "download"
                    case "Pictures": "image"
                    case "Music": "music_note"
                    default: "movie"
                }
                places.Add(Place(icon, place.Key, place.Value, path, navigate, p, drop, dropPath))
            }
            if showVirtual {
                places.Add(Place("history", "Recent", Locations.Recent, path, navigate, p))
                if trashPath != "" {
                    var count Blob? = nil
                    if trashCount > 0 {
                        count = Container{
                            Height: 18,
                            MinWidth: 18,
                            FlexShrink: 0,
                            Padding: Edges{Left: 6, Right: 6},
                            BorderRadius: 9,
                            BackgroundColor: p.Border,
                            AlignItems: AlignItems.Center,
                            JustifyContent: JustifyContent.Center,
                            Ui.Label(trashCount.ToString(), p.Text, 11),
                        }
                    }
                    places.Add(Place("delete", "Trash", trashPath, path, navigate, p, trailing: count))
                }
            }
        }

        private func BuildBookmarks(
            places List[Blob],
            path string,
            navigate Action[string],
            bookmarks IReadOnlyList[string],
            bookmarkKey string,
            window Window,
            p Palette,
            drop Func[string, DropTarget]?,
            dropPath string,
            bookmarkDrop Func[int32, DropTarget]?,
            bookmarkDropIndex int32,
            bookmarkMenu Action[string, Point]?,
            bookmarkMenuKey Action[string, KeyEvent, Point]?
        ) {
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
                        drop: drop,
                        dropPath: dropPath,
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
        }

        private func BuildDevices(
            places List[Blob],
            path string,
            navigate Action[string],
            window Window,
            p Palette,
            drop Func[string, DropTarget]?,
            dropPath string,
            volumes IReadOnlyList[Volume]?,
            openVolume Action[Volume]?,
            ejectVolume Action[Volume]?
        ) {
            places.Add(Ui.Section("DEVICES", p))
            places.Add(Place("hard_drive", "File system", "/", path, navigate, p, drop, dropPath))
            for volume in volumes ?? List[Volume]() {
                if volume.MountPath == "/" {
                    continue
                }
                let mounted = volume.MountPath != ""
                var eject Blob? = nil
                if mounted && volume.Ejectable {
                    eject = Ui.Tool(
                        "eject",
                        "Eject " + volume.Name,
                        () -> ejectVolume?.Invoke(volume),
                        window,
                        p,
                        size: 22,
                        iconSize: 16,
                        hoverColor: p.Selection
                    )
                }
                places.Add(
                    Place(
                        volume.Removable ? "usb": "hard_drive",
                        volume.Name,
                        volume.MountPath,
                        path,
                        _ -> openVolume?.Invoke(volume),
                        p,
                        mounted ? drop: nil,
                        dropPath,
                        muted: !mounted,
                        trailing: eject
                    )
                )
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
            contextMenu Action[Point]? = nil,
            contextMenuKey Action[KeyEvent, Point]? = nil
        ) Blob -> Container{
            FlexShrink: 0,
            Ui.HoverLabel(
                path,
                path,
                Place("bookmark", label, path, current, navigate, p, drop, dropPath, contextMenu, contextMenuKey),
                window,
                p,
                placement,
                true
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
            contextMenuKey Action[KeyEvent, Point]? = nil,
            muted bool = false,
            trailing Blob? = nil
        ) Blob -> Cell
            .Mount[SidebarLinkInput, SidebarLink](
            nil,
            SidebarLinkInput{
                Icon: icon,
                Label: name,
                Active: destination != "" && current == destination,
                Action: () -> navigate(destination),
                OnContextMenu: contextMenu,
                OnContextMenuKey: contextMenuKey,
                DropTarget: drop?.Invoke(destination),
                DropActive: destination != "" && destination == dropPath,
                Muted: muted,
                Trailing: trailing,
                Palette: p,
            }
        )
    }
}
