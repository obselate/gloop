package gloop

import Goo

partial class BrowserView {
    private func RefreshPlacesOnFocus(focused bool) {
        if focused {
            Model.Places.Refresh()
        }
    }

    private func SpaceStatus() Blob? {
        if width < 760 || Model.InRecent {
            return nil
        }

        if Model.InCloud {
            let cfg = Model.GoogleDrive.ConfigSnapshot()
            let label = if cfg.StorageLimit > 0 {
                FileSystemService.FormatSize(cfg.StorageUsed) + " of " + FileSystemService.FormatSize(cfg.StorageLimit)
            } else if !string.IsNullOrWhiteSpace(cfg.AccountEmail) {
                cfg.AccountEmail
            } else {
                "Google Drive"
            }

            return Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                FlexShrink: 0,
                Gap: 5,
                Ui.Icon("cloud_done", palette.Muted, 14),
                Ui.Label(label, palette.Muted, 11),
            }
        }

        let space = Model.Places.Space

        if space.TotalBytes <= 0 {
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
