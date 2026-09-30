# <img src="assets/gloop.png" width="48" height="48" alt=""> Gloop

A keyboard-first file manager for Linux and Wayland. Built with G# and Goo.

## Install

### AUR

Install [gloop-bin](https://aur.archlinux.org/packages/gloop-bin) with your AUR helper:

```sh
yay -S gloop-bin
```

Or use `paru -S gloop-bin`. See the [Arch installation guide](packaging/aur/gloop-bin/README.md)
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

## Performance

<details>
<summary>Recorded benchmarks and hardware</summary>

Measured on an AMD Ryzen 7 3700X, NVIDIA RTX 3080, 64 GiB RAM, Btrfs,
and CachyOS Linux 7.2.7. These are warm-cache measurements on a shared host.
The tables identify the measured versions. These are historical results.

**Gloop 0.4.0 memory** <sup>[1](#performance-note-1)</sup>

| Files | Process PSS | Process RSS |
| ---: | ---: | ---: |
| 0 | 85.1 MiB | 148.5 MiB |
| 100 | 87.6 MiB | 151.1 MiB |
| 10,000 | 100.4 MiB | 163.8 MiB |
| 100,000 | 177.9 MiB | 241.2 MiB |

**Gloop 0.3.0 candidate startup and runtime** <sup>[2](#performance-note-2)</sup>

| Files | First frame feedback | Startup CPU | PSS | RSS | CPU 1.5 to 3.5 s |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 336.4 ms | 263.7 ms | 87.1 MiB | 148.0 MiB | 3.6 ms |
| 10,000 | 397.8 ms | 303.8 ms | 98.3 MiB | 159.3 MiB | 2.6 ms |
| 100,000 | 344.0 ms | 665.9 ms | 170.2 MiB | 231.3 MiB | 2.2 ms |

**Gloop 0.4.0 publishing** <sup>[3](#performance-note-3)</sup>

| NativeAOT profile | Executable | Publish time |
| --- | ---: | ---: |
| Size | 19,688,240 bytes | 22.855 s |
| Speed | 20,534,864 bytes | 24.032 s |

**Earlier managed Release processing benchmarks** <sup>[4](#performance-note-4)</sup>

| Workload | Before | After |
| --- | ---: | ---: |
| Directory listing and view processing, 10,000 files | 43.96 ms | 40.35 ms |
| Directory listing and view processing, 100,000 files | 347.57 ms | 309.82 ms |
| Same 100,000 files, filter with one match | 340.63 ms | 286.96 ms |
| DataGrid build, 100,000 rows, selection near start | 11,376 us | 93 us |
| DataGrid build, 100,000 rows, selection at end | 12,801.5 us | 1,268 us |
| DataGrid allocation per unchanged-row build | 10,633,472 bytes | 7,864 bytes |

1. <a id="performance-note-1"></a> **Memory:** NativeAOT Size, Goo 0.7.8,
   private KWin Wayland, 1180x760 window. Median of three fresh launches per
   zero-byte-file fixture, sampled for 15 seconds in list mode. Preview and
   split were off. PSS apportions shared resident memory. RSS counts each
   process's resident mappings. Both exclude GPU and compositor memory.
   Image and text previews can raise memory above these directory-only figures.

2. <a id="performance-note-2"></a> **Startup and runtime:** local Goo 0.7.4,
   Hyprland 0.56.2, 1398x858 windows, NVIDIA driver 615.71.09. Median of three
   warm launches after one warmup per fixture. First frame feedback includes
   Wayland tracing and delivery to the harness. It does not measure directory
   readiness. A separate untraced pass measured CPU over startup's first
   1.5 seconds, memory at 3.5 seconds, and CPU time over the intervening
   2 seconds. Runs used a systemd scope launcher. A resident inference server
   remained running. These results do not establish a general speed ranking
   or cold-start performance.

3. <a id="performance-note-3"></a> **Publishing:** Ubuntu 24.04, build limited
   to two CPU cores and 8 GiB RAM. One publish observation per profile,
   separate from runtime.

4. <a id="performance-note-4"></a> **Processing:** same Ryzen 7 3700X host.
   These measure individual stages, not complete UI interactions. Directory
   results are medians of 14 samples, with each process's first iteration
   discarded. DataGrid results compare Goo Widgets 0.2.8 and 0.2.9, with
   60 builds per case after three warmups in each of three processes.

</details>

## Links

- [Downloads and release notes](https://github.com/obselate/gloop/releases)
- [Goo UI framework](https://github.com/obselate/goo)
- [Report an issue](https://github.com/obselate/gloop/issues)
- [MIT license](LICENSE)
