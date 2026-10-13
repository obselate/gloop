# <img src="assets/gloop.png" width="48" height="48" alt=""> Gloop

A keyboard-first file manager for Linux and Wayland. Built with G# and Goo.

## Install

### AUR

Install [gloop-bin](https://aur.archlinux.org/packages/gloop-bin) with your AUR helper:

```sh
yay -S gloop-bin
```

Or
```sh
paru -S gloop-bin
``` 

See the [Arch installation guide](packaging/aur/gloop-bin/README.md)
for manual installation or migration from a portable install.

### Download

Download the [Linux release](https://github.com/obselate/gloop/releases/latest),
extract it, and run `./gloop`. No .NET runtime is needed.

Run `./gloop --help` for optional desktop integration and folder or file dialog defaults.

## Features

| Feature | Includes |
| --- | --- |
| Browse | List and tile views, thumbnails, sorting, filename filters, and clickable paths. |
| Preview | Whole images and text, with word wrap, line numbers, and code highlighting. |
| Work with files | Multi-select, create folders, rename, copy, move, Trash, and drag between folders or apps. |
| Navigate | Bookmarks, optional split panes, and a terminal in the current folder. |
| Customize | Theme presets, an OKLCH color wheel, rebindable shortcuts, and settings that apply immediately. |

Copy works across filesystems. Cross-filesystem move and Trash report an error
and preserve the source. Remote filesystems are not implemented.

## Requirements

Linux x86-64, glibc 2.39 or newer, Wayland, and Vulkan 1.3 drivers.
Tested on KDE Plasma.

## Build from source

To compile Gloop yourself, follow the [source build guide](BUILD.md).

## Links

- [Downloads and release notes](https://github.com/obselate/gloop/releases)
- [Goo UI framework](https://github.com/obselate/goo)
- [Report an issue](https://github.com/obselate/gloop/issues)
- [MIT license](LICENSE)
