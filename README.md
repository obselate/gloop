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

## Performance

<details>
<summary>Gloop v0.7.2 measurements, October 1, 2026</summary>

The released NativeAOT Size executable is 14.2% smaller than Gloop 0.7.1
(`c0efcfe`). It embeds 53 required Material icons instead of the full 4,128,
uses packed Linux relocations, and reduces directory and preview work.
Delivery remains one executable with embedded third-party notices.

**Publishing on Ubuntu 24.04**

| Build | Executable | Publish time |
| --- | ---: | ---: |
| 0.7.1, Size | 20,534,288 bytes | 26.735 s |
| 0.7.2, Size | 17,615,832 bytes | 30.249 s |
| 0.7.2, Speed | 18,572,856 bytes | 22.188 s |

Each profile has one fresh warm-payload publish observation using .NET SDK
10.0.401, limited to two CPUs and 8 GiB RAM. Timing covers `dotnet publish`
only, excluding restore and packaging checks. Speed ran after Size and may
reuse intermediates. These single observations do not establish publish-time
improvements. Both 0.7.2 profiles require GLIBC_2.38, within the supported
2.39 baseline. The separate release CI Size publish took 30.736 s on its
unrestricted runner and is not part of this controlled comparison.

**Matched warm launches**

| Workload | Build | First buffer | CPU, first 3 s | RSS | PSS | GPU memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 100 files, list | 0.7.1 Size | 294.39 ms | 300 ms | 148.7 MiB | 92.0 MiB | 89 MiB |
| 100 files, list | 0.7.2 Size | 334.87 ms | 340 ms | 147.9 MiB | 88.0 MiB | 89 MiB |
| 100 files, list | 0.7.2 Speed | 341.30 ms | 340 ms | 147.3 MiB | 90.6 MiB | 89 MiB |
| 100,000 files, list | 0.7.1 Size | 381.28 ms | 790 ms | 230.6 MiB | 173.7 MiB | 89 MiB |
| 100,000 files, list | 0.7.2 Size | 369.30 ms | 740 ms | 218.3 MiB | 158.2 MiB | 89 MiB |
| 100,000 files, list | 0.7.2 Speed | 303.47 ms | 660 ms | 218.2 MiB | 161.4 MiB | 89 MiB |
| 100,000 files, tiles | 0.7.1 Size | 407.87 ms | 860 ms | 200.1 MiB | 143.5 MiB | 89 MiB |
| 100,000 files, tiles | 0.7.2 Size | 367.63 ms | 750 ms | 188.3 MiB | 128.3 MiB | 89 MiB |
| 100,000 files, tiles | 0.7.2 Speed | 373.46 ms | 700 ms | 188.3 MiB | 131.6 MiB | 89 MiB |
| Three 4096x4096 PNGs, preview open | 0.7.1 Size | 359.56 ms | 1,580 ms | 421.0 MiB | 362.7 MiB | 153 MiB |
| Three 4096x4096 PNGs, preview open | 0.7.2 Size | 305.81 ms | 960 ms | 410.0 MiB | 348.5 MiB | 93 MiB |
| Three 4096x4096 PNGs, preview open | 0.7.2 Speed | 268.65 ms | 910 ms | 410.0 MiB | 351.7 MiB | 93 MiB |

**v0.7.2 process peak RSS and idle CPU**

| Workload | Size peak RSS | Speed peak RSS | Size idle CPU | Speed idle CPU |
| --- | ---: | ---: | ---: | ---: |
| 100 files, list | 161.2 MiB | 160.5 MiB | 0.5% | 0.0% |
| 100,000 files, list | 231.6 MiB | 231.4 MiB | 0.0% | 0.0% |
| 100,000 files, tiles | 201.8 MiB | 201.7 MiB | 0.0% | 0.0% |
| Three 4096x4096 PNGs, preview open | 490.2 MiB | 490.0 MiB | 0.0% | 0.0% |

Peak RSS is the median process `VmHWM` through the five-second sample. Idle
CPU is the median percentage of one core during the three-to-five-second
interval. A displayed 0.0% does not establish zero CPU use outside that interval.
Image decoding still needs a temporary full raster. The Size image case
reached 490.2 MiB peak RSS, compared with 513.3 MiB for 0.7.1. Bounding preview
dimensions reduces retained image and GPU data but does not eliminate this
decoding cost.

**Why Size remains the default**

Speed adds 957,024 bytes (5.4%). It used 50 to 80 ms less CPU in the large-folder
and image cases, while first-buffer results were mixed. Size keeps the smaller
executable. Three runs on a shared host do not establish a consistent startup
advantage for either profile or a general startup improvement over 0.7.1.

Measured on an AMD Ryzen 7 3700X, NVIDIA RTX 3080 with driver 615.71.09,
64 GiB RAM, Btrfs, and CachyOS Linux 7.2.7. Each runtime value is the median
of three warm launches with alternating build order. Each build received one
warmup before each benchmark group (list, tiles, and images). The list group
warmed up on 100 files before measuring both folder sizes. Runs used a private
KWin Wayland compositor, a 1180x760 window, 1440x900 output at scale 1, and no
Goo developer tools. GC tuning overrides were unset.

First buffer measures process launch to the first non-null Wayland buffer
attachment observed in the client trace. It includes trace delivery overhead
and does not measure presentation, directory readiness, or preview readiness.
CPU time covers approximately the first three seconds, with 10 ms accounting
resolution. RSS and PSS were sampled around five seconds. They exclude GPU
and compositor memory. GPU values are per-process samples, not peaks.
These shared-host, warm-cache results do not establish cold-start performance
or a ranking against other file managers.

The initial tile cohort stopped when the historical 0.7.1 baseline failed to
create a Vulkan swapchain. Its incomplete data were excluded, and the full
matched cohort was repeated once. All 36 measured launches and nine warmups
in the completed cohorts passed. The cause of the initial failure is unknown.

Source: [v0.7.2](https://github.com/obselate/gloop/tree/v0.7.2), commit
`18abcdf769498e1923481f513eccd5cbae6749b8`, using Goo and Goo.Svg 0.7.13,
Goo.Widgets 0.2.13, and Goo.Animations 0.2.5. Runtime Size measurements used
the exact downloaded release executable, also installed locally, with SHA-256
`28c9cc2f583c94db4e67c40224cf92a073e66cff8147ca8c204cddf3722ca6bd`.
Speed was rebuilt from the same tag with the Speed profile. The exact release
executable passed Wayland visual, keyboard, scrolling, preview, split-pane,
and selection checks.

</details>

## Links

- [Downloads and release notes](https://github.com/obselate/gloop/releases)
- [Goo UI framework](https://github.com/obselate/goo)
- [Report an issue](https://github.com/obselate/gloop/issues)
- [MIT license](LICENSE)
