package gloop

import Goo
import System

class FileTransferUi {
    shared {
        internal func Name(entry FileEntry) string -> entry.Name + (entry.IsSymlink ? " ↗": "")

        internal func Root(root Container, value FileTableInput, clicks FileClickState) Container {
            root.DropTarget = value.DropTarget(value.Pane.DirectoryPath)
            root.OutlineWidth = value.DropPath == value.Pane.DirectoryPath ? 1: 0
            root.OutlineColor = value.Palette.Accent
            root.OutlineOffset = -1
            root.OnPointerDown = e -> {
                if e.Button == PointerButton.Primary && !e.IsFromInteractiveChild
                && !e.Modifiers.Ctrl && !e.Modifiers.Shift && !e.Modifiers.Super {
                    value.OnClear()
                }
            }
            root.OnPointerUp = e -> BackgroundContextMenu(e, value, clicks)

            return root
        }

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

            value.OnSelect(index, activate ? false: ctrl, activate ? false: shift)

            if activate {
                value.OnOpen()
            }
        }

        internal func Bind(root Container, entry FileEntry, value FileTableInput, clicks FileClickState) Container {
            let onPointerUp = root.OnPointerUp

            root.OnPointerUp = e -> {
                if e.Button == PointerButton.Secondary {
                    clicks.Count = 0
                    clicks.Path = ""
                    e.PreventDefault()
                    e.StopPropagation()
                    value.OnContextMenu(value.Pane.VisibleEntries.IndexOf(entry), e.WindowPosition)
                    return
                }

                if e.Button == PointerButton.Primary {
                    let now = Environment.TickCount64
                    let repeated = clicks.Path == entry.FullPath && now - clicks.Time <= 500

                    clicks.Count = repeated ? 2: 1
                    clicks.Path = entry.FullPath
                    clicks.Time = repeated ? 0: now

                    value.Host.Post(() -> clicks.Count = 0)
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

        internal func BackgroundContextMenu(e PointerEvent, value FileTableInput, clicks FileClickState) {
            if e.Button != PointerButton.Secondary || e.IsFromInteractiveChild {
                return
            }

            clicks.Count = 0
            clicks.Path = ""
            e.PreventDefault()
            e.StopPropagation()
            value.OnContextMenu(-1, e.WindowPosition)
        }
    }
}
