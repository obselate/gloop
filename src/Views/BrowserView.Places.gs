package gloop

import Goo
import System

partial class BrowserView {
    private func RefreshPlacesOnFocus(focused bool) {
        if focused {
            Model.Places.Refresh()
        }
    }

    private func LocationKind(pane BrowserPane) string {
        if Locations.IsRecent(pane.DirectoryPath) {
            return "recent"
        }
        return Model.InTrash(pane.DirectoryPath) ? "trash": ""
    }

    private func OpenVolume(volume Volume) {
        if volume.MountPath != "" {
            Model.Navigate(volume.MountPath)
            FocusFiles()
            return
        }
        notice = ""
        Model.Places.Mount(
            volume,
            (path, error) -> {
                notice = error
                if error == "" {
                    Model.Navigate(path)
                    FocusFiles()
                }
                Rebuild()
            }
        )
    }

    private func EjectVolume(volume Volume) {
        notice = ""
        Model.LeaveMount(volume.MountPath)
        Model.Places.Eject(
            volume,
            (_, error) -> {
                notice = error
                Rebuild()
            }
        )
    }
}
