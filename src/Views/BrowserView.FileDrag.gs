package gloop

import Goo
import System.Collections.Generic

partial class BrowserView {
    private let transfers FileTransferService = FileTransferService()
    private let bookmarkDrops BookmarkDropService = BookmarkDropService()
    private var bookmarkDropIndex int32 = -1

    private func CreateFileDrag(paneIndex int32, sourcePath string) DragData? {
        if !Model.CanDrag(paneIndex) {
            return nil
        }

        transfers.Clear()

        guard let payload = transfers.Snapshot(Model.Pane(paneIndex), sourcePath) else {
            return nil
        }

        if NativeFileDrag.TryCreate(payload.Paths, out var native) {
            return DragData(payload, DragEffect.Copy | DragEffect.Move, native)
        }

        Model.DragTooLarge()

        return DragData(payload, DragEffect.Copy | DragEffect.Move)
    }

    private func FileDropEffect(data DragData, destination string, copy bool) DragEffect {
        if !Model.CanDrop(destination) {
            return DragEffect.None
        }

        if let payload = data.Value as FileDragPayload? {
            if !transfers.ValidTarget(payload.Paths, destination, false) {
                return DragEffect.None
            }

            let effect = copy ? DragEffect.Copy: DragEffect.Move

            return (int32(data.AllowedEffects) & int32(effect)) != 0 ? effect: DragEffect.None
        }

        if let incoming = data.Value as NativeFileDrop? {
            if (int32(data.AllowedEffects) & int32(DragEffect.Copy)) != 0 && transfers.ValidTarget(
                incoming.Paths,
                destination,
                incoming.IsPreview
            ) {
                return DragEffect.Copy
            }
        }

        return DragEffect.None
    }

    private func QueueFileDrop(data DragData, destination string, effect DragEffect) {
        let valid = effect != DragEffect.None && FileDropEffect(data, destination, effect == DragEffect.Copy) == effect
        let sources = List[string]()

        if valid {
            if let payload = data.Value as FileDragPayload? {
                sources.AddRange(payload.Paths)
            } else if let incoming = data.Value as NativeFileDrop? {
                if !incoming.IsPreview {
                    sources.AddRange(incoming.Paths)
                }
            }
        }

        transfers.Clear()

        if valid {
            Model.QueueFileDrop(sources, destination, effect == DragEffect.Copy)
        }
    }

    private func FileDropTarget(destination string) DropTarget -> DropTarget(
        e -> chooser == nil ? FileDropEffect(e.Data, destination, e.Modifiers.Ctrl): DragEffect.None,
        e -> {
            if chooser != nil {
                return
            }
            if e.Kind == DragEventKind.Drop {
                QueueFileDrop(e.Data, destination, e.Effect)
                ClearDropTarget()
            } else if e.Kind == DragEventKind.Leave {
                transfers.Clear()
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

    private func BookmarkDropEffect(data DragData) DragEffect {
        if (int32(data.AllowedEffects) & int32(DragEffect.Copy)) == 0 {
            return DragEffect.None
        }

        if let payload = data.Value as FileDragPayload? {
            return bookmarkDrops.Valid(payload.Paths, false) ? DragEffect.Copy: DragEffect.None
        }

        if let incoming = data.Value as NativeFileDrop? {
            return bookmarkDrops.Valid(incoming.Paths, incoming.IsPreview) ? DragEffect.Copy: DragEffect.None
        }

        return DragEffect.None
    }

    private func BookmarkDropPaths(data DragData) List[string] {
        if let payload = data.Value as FileDragPayload? {
            return BookmarkDropService.NormalizePaths(payload.Paths) ?? List[string]()
        }

        if let incoming = data.Value as NativeFileDrop? {
            if !incoming.IsPreview {
                return BookmarkDropService.NormalizePaths(incoming.Paths) ?? List[string]()
            }
        }

        return List[string]()
    }

    private func BookmarkDropTarget(index int32) DropTarget -> DropTarget(
        e -> chooser == nil ? BookmarkDropEffect(e.Data): DragEffect.None,
        e -> {
            if chooser != nil {
                return
            }
            if e.Kind == DragEventKind.Drop {
                let paths = BookmarkDropPaths(e.Data)
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
