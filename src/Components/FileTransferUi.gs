package gloop

import Goo

class FileClickState {
    internal var Count int32
    internal var Path string = ""
}

class FileTransferUi {
    shared {
        private func Create(entry FileEntry, value FileTableInput) DragData? {
            if !value.Pane.SelectedPaths.Contains(entry.FullPath) {
                value.OnSelect(value.Pane.VisibleEntries.IndexOf(entry), false, false)
            }
            return value.OnDrag(entry.FullPath)
        }

        internal func Select(
            entry FileEntry,
            index int32,
            value FileTableInput,
            clicks FileClickState,
            ctrl bool,
            shift bool
        ) {
            let activate = clicks.Path == entry.FullPath && clicks.Count == 2
            clicks.Count = 0
            clicks.Path = ""
            value.OnSelect(index, activate ? false: ctrl, activate ? false: shift)
            if activate {
                value.OnOpen()
            }
        }

        internal func Bind(root Container, entry FileEntry, value FileTableInput, clicks FileClickState) Container {
            let onPointerUp = root.OnPointerUp
            root.OnPointerUp = e -> {
                if e.Button == PointerButton.Primary {
                    clicks.Count = e.ClickCount
                    clicks.Path = entry.FullPath
                    value.Host.Post(
                        () -> {
                            clicks.Count = 0
                            clicks.Path = ""
                        }
                    )
                }
                onPointerUp?.Invoke(e)
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
