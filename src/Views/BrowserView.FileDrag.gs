package gloop

import Goo

partial class BrowserView {
    private let bookmarkDrops BookmarkDropService = BookmarkDropService()
    private var bookmarkDropIndex int32 = -1

    private func FileDropTarget(destination string) DropTarget -> DropTarget(
        e -> chooser == nil ? Model.FileDropEffect(e.Data, destination, e.Modifiers.Ctrl): DragEffect.None,
        e -> {
            if chooser != nil {
                return
            }
            if e.Kind == DragEventKind.Drop {
                Model.QueueFileDrop(e.Data, destination, e.Effect)
                ClearDropTarget()
            } else if e.Kind == DragEventKind.Leave {
                Model.ClearFileDropCache()
                if dropPath == destination {
                    ClearDropTarget()
                }
            } else if dropPath != destination {
                dropPath = destination
                Rebuild()
            }
        },
        true
    )

    private func BookmarkDropTarget(index int32) DropTarget -> DropTarget(
        e -> chooser == nil ? bookmarkDrops.Effect(e.Data): DragEffect.None,
        e -> {
            if chooser != nil {
                return
            }
            if e.Kind == DragEventKind.Drop {
                let paths = bookmarkDrops.Paths(e.Data)
                if paths.Count > 0 {
                    notice = settingsWriter?.InsertBookmarks(settings, paths, index) ?? ""
                }
                ClearDropTarget()
                Rebuild()
            } else if e.Kind == DragEventKind.Leave {
                bookmarkDrops.Clear()
                if bookmarkDropIndex == index {
                    ClearDropTarget()
                }
            } else if bookmarkDropIndex != index {
                bookmarkDropIndex = index
                dropPath = ""
                Rebuild()
            }
        },
        true
    )

    private func ClearDropTarget() {
        bookmarkDrops.Clear()
        if dropPath != "" || bookmarkDropIndex >= 0 {
            dropPath = ""
            bookmarkDropIndex = -1
            Rebuild()
        }
    }
}
