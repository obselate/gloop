package gloop

import Goo

partial class BrowserView {
    private func RefreshPlacesOnFocus(focused bool) {
        if focused {
            Model.Places.Refresh()
        }
    }

    private func SpaceStatus() Blob? {
        let space = Model.Places.Space
        if width < 760 || space.TotalBytes <= 0 || Model.InRecent {
            return nil
        }
        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            FlexShrink: 0,
            Gap: 5,
            Ui.Icon("hard_drive", palette.Muted, 14),
            Ui.Label(
                FileSystemService.FormatSize(space.FreeBytes) + " free of " + FileSystemService.FormatSize(
                    space.TotalBytes
                ),
                palette.Muted,
                11
            ),
        }
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
