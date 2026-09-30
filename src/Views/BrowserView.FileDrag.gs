package gloop

import Goo

partial class BrowserView {
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

    private func ClearDropTarget() {
        if dropPath != "" {
            dropPath = ""
            Rebuild()
        }
    }
}
