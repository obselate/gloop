package gloop

import Goo

class FileClickState {
    internal var Count int32
}

class FileTransferUi {
    shared {
        private func Create(entry FileEntry, value FileTableInput) DragData? {
            if !value.Pane.SelectedPaths.Contains(entry.FullPath) {
                value.OnSelect(value.Pane.VisibleEntries.IndexOf(entry), false, false)
            }
            return value.OnDrag(entry.FullPath)
        }

        internal func Bind(root Container, entry FileEntry, value FileTableInput, clicks FileClickState) Container {
            let onPointerDown = root.OnPointerDown
            let onClick = root.OnClick
            root.OnPointerDown = e -> {
                if e.Button == PointerButton.Primary {
                    clicks.Count = e.ClickCount
                }
                onPointerDown?.Invoke(e)
            }
            root.OnClick = () -> {
                onClick?.Invoke()
                if clicks.Count == 2 {
                    value.OnSelect(value.Pane.VisibleEntries.IndexOf(entry), false, false)
                    value.OnOpen()
                }
            }
            root.DragSource = DragSource(
                (_ DragStartEvent) -> Create(entry, value),
                (_ DragEndEvent) -> value.OnDragEnd()
            )
            if entry.IsDirectory {
                root.DropTarget = value.DropTarget(entry.FullPath)
            }
            if value.DropPath == entry.FullPath {
                root.OutlineWidth = 1
                root.OutlineColor = value.Palette.Accent
                root.OutlineOffset = -1
            }
            return root
        }
    }
}
