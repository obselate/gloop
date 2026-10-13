package gloop

partial class BrowserController {
    internal func CanRun(action string) bool {
        if ActivePane().Kind == LocationKind.Archive &&
            (
            action == "Rename" ||
                action == "Trash" ||
                action == "Cut" ||
                action == "Copy" ||
                action == "Paste" ||
                action == "NewFolder" ||
                action == "Compress" ||
                action == "OpenTerminal" ||
                action == "OpenTerminalHere" ||
                action == "ToggleBookmark"
        ) {
            return false
        }

        if action == "Extract" || action == "Compress" {
            if InTrashView || InRecent || ActivePane().SelectedPaths.Count == 0 {
                return false
            }

            if action == "Extract" && ActivePane().Kind != LocationKind.Archive {
                for source in ActivePane().SelectionPaths() {
                    if !ArchiveService.Supported(source) {
                        return false
                    }
                }
            }
        }

        if InTrashView {
            if action == "NewFolder" || action == "Rename" || action == "Copy"
            || action == "Cut" || action == "Paste" || action == "Trash" {
                return false
            }

            if action == "Open" {
                return ActivePane().SingleSelectedEntry()?.IsDirectory ?? false
            }

            if action == "Restore" || action == "DeletePermanently" {
                return AtTrashRoot
            }

            if action == "EmptyTrash" {
                return AtTrashRoot && Places.TrashCount > 0
            }

            return true
        }

        if InRecent &&
            (
            action == "NewFolder" || action == "Paste" || action == "ToggleBookmark"
            || action == "OpenTerminalHere"
            || (action == "OpenTerminal" && !(ActivePane().SingleSelectedEntry()?.IsDirectory ?? false))
        ) {
            return false
        }

        let empty = ActivePane().SelectedPaths.Count == 0

        if InRecent {
            return !empty || (action != "CopyPath" && action != "Properties")
        }

        if ActivePane().DirectoryPath == "" || ActivePane().Error != "" {
            return action != "OpenTerminal" &&
                action != "OpenTerminalHere" &&
                (
                !empty || (action != "NewFolder" && action != "Paste" && action != "CopyPath" && action != "Properties")
            )
        }

        return true
    }
}
