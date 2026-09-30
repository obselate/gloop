# Install Gloop on Arch Linux

Install [gloop-bin](https://aur.archlinux.org/packages/gloop-bin) with
`yay -S gloop-bin` or `paru -S gloop-bin`. The package uses the published
NativeAOT executable. No .NET SDK or runtime is needed.

If you used the portable installer, read the migration instructions below first.

## Manual installation

Run `makepkg` as a regular user:

```sh
sudo pacman -S --needed base-devel git
git clone https://aur.archlinux.org/gloop-bin.git
cd gloop-bin
less PKGBUILD
makepkg -si
```

The package installs the executable, launcher, icon, AppStream metadata and
chooser registration. Folder and chooser defaults remain optional:

```sh
/usr/bin/gloop --set-default
/usr/bin/gloop --set-default-chooser
```

Chooser support requires `xdg-desktop-portal`. After selecting it, log out and
back in, then restart applications. Restore the previous chooser with
`/usr/bin/gloop --restore-default-chooser`.

## Portable migration

<details>
<summary>Move from a portable installation</summary>

If the portable chooser is selected, run the existing portable executable with
`--restore-default-chooser` first. Back up and move only these Gloop-owned files
out of their original paths so they do not override the package:

- `~/.local/bin/gloop`
- `~/.local/share/applications/io.github.obselate.gloop.desktop`
- `~/.local/share/icons/hicolor/512x512/apps/io.github.obselate.gloop.png`
- `~/.local/share/metainfo/io.github.obselate.gloop.metainfo.xml`
- `~/.local/share/dbus-1/services/org.freedesktop.impl.portal.desktop.gloop.service`
- `~/.local/share/xdg-desktop-portal/portals/gloop.portal`

Use `XDG_DATA_HOME` instead of `~/.local/share` if configured. Preserve other
files, settings and bookmarks. Use `/usr/bin/gloop` for the optional defaults
above, then log out and back in to replace any running portable chooser backend.
The package does not remove user files or change defaults during installation.

</details>
