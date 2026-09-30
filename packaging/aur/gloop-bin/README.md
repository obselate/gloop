# Gloop AUR package

`gloop-bin` packages the published Linux x86-64 NativeAOT executable without
rebuilding or stripping it. It requires glibc 2.39 or newer, Wayland and a Vulkan
1.3 driver. SDL, HarfBuzz and application libraries remain embedded. No .NET
runtime is needed.

The package owns `/usr/bin/gloop`, its desktop launcher, icon, AppStream metadata,
chooser D-Bus service, portal descriptor and license notices. It has no install
hooks and does not select folder or chooser defaults. Pacman's standard desktop
and icon-cache hooks handle registration.

## Install from AUR

Install [gloop-bin](https://aur.archlinux.org/packages/gloop-bin) with
`yay -S gloop-bin` or `paru -S gloop-bin`. Read the migration steps below first
if you used the portable installer.

To install manually, use a regular user with Arch's `base-devel` and Git installed:

```sh
git clone https://aur.archlinux.org/gloop-bin.git
cd gloop-bin
less PKGBUILD
makepkg -si
```

## Build and check

From the repository root, build in ignored output rather than in this directory:

```sh
mkdir -p artifacts/packaging/aur-build
cp packaging/aur/gloop-bin/PKGBUILD packaging/aur/gloop-bin/*.desktop packaging/aur/gloop-bin/*.service packaging/aur/gloop-bin/*.portal artifacts/packaging/aur-build/
cd artifacts/packaging/aur-build
makepkg --cleanbuild
makepkg --printsrcinfo > .SRCINFO
bsdtar -tf gloop-bin-0.6.0-1-x86_64.pkg.tar.zst
```

Run `makepkg` as a regular user with Arch's `base-devel` installed. Install missing
runtime dependencies through pacman. `vulkan-driver` lets pacman use the installed
hardware driver or ask for a provider. `xdg-desktop-portal` is optional for normal
browsing and required to use Gloop as a portal chooser.

Install the built package with `sudo pacman -U gloop-bin-0.6.0-1-x86_64.pkg.tar.zst`
from the build directory. Read the migration steps below first if you used the
portable installer.

Before publishing, validate the desktop and AppStream files, compare the packaged
executable with the release bytes, and exercise actual package installation,
upgrade, removal and Wayland startup. CLI checks alone do not verify rendering.

## Publish and update

Publishing uses the AUR account `obselate` and a dedicated SSH publishing key.
Register its public key with that account before pushing. The packaging sources
use the repository's existing MIT license.

Clone
`ssh://aur@aur.archlinux.org/gloop-bin.git` and copy only `PKGBUILD`, `.SRCINFO`,
the three local registration files and `LICENSE` into that checkout. Review the
diff, commit and push its `master` branch. Do not upload binaries or downloaded
release sources to AUR.

For a new published Gloop release, update `pkgver`, reset `pkgrel` to 1, verify
the immutable release and tag assets, and replace their checksums. Increment
`pkgrel` for packaging-only changes. Rebuild, regenerate the maintained recipe's `.SRCINFO` and repeat
the relevant package checks. Update local registration checksums if they change.

## Migrate a portable installation

The package never removes user files. If the portable chooser is selected, run
the existing portable executable with `--restore-default-chooser` first to
restore its previous preference and owned environment settings.

Back up and move only these Gloop-owned portable files out of their original
paths before using the system package. Preserve unrelated files and settings:

- `~/.local/bin/gloop`
- `~/.local/share/applications/io.github.obselate.gloop.desktop`
- `~/.local/share/icons/hicolor/512x512/apps/io.github.obselate.gloop.png`
- `~/.local/share/metainfo/io.github.obselate.gloop.metainfo.xml`
- `~/.local/share/dbus-1/services/org.freedesktop.impl.portal.desktop.gloop.service`
- `~/.local/share/xdg-desktop-portal/portals/gloop.portal`

If `XDG_DATA_HOME` is set, use that directory instead of `~/.local/share`.
User launchers and chooser registrations can shadow the system package.

After installation, use `/usr/bin/gloop` explicitly. Folder and chooser defaults
remain separate opt-ins:

```sh
/usr/bin/gloop --set-default
/usr/bin/gloop --set-default-chooser
```

Log out and back in, then restart applications. This refreshes session environment
settings and replaces any portable chooser backend still running from its old
executable path. Restore chooser preferences with
`/usr/bin/gloop --restore-default-chooser` before removing the package if desired.

Gloop replaces standard portal-capable open/save dialogs. Ark's embedded extraction
browser remains Ark-owned. Opening the destination after extraction uses the
default folder application. Existing Gloop preferences and bookmarks are retained.

References: [AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines),
[Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines),
[Gloop releases](https://github.com/obselate/gloop/releases).
