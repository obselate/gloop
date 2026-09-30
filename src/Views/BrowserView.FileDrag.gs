package gloop

import Goo

partial class BrowserView {
    private func FileDropTarget(destination string) DropTarget -> DropTarget(
        e -> Model.FileDropEffect(e.Data, destination, e.Modifiers.Ctrl),
        e -> {
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
