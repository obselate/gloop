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
<summary>October 2026 optimization measurements</summary>

Compared with Gloop 0.7.1 (`c0efcfe`), the optimized NativeAOT Size build is
14.2% smaller. It embeds 53 required Material icons instead of the full 4,128,
uses packed Linux relocations, and reduces directory and preview work.
Delivery remains one executable with embedded third-party notices.

**Publishing on Ubuntu 24.04**

| Build | Executable | Publish time |
| --- | ---: | ---: |
| Before, Size | 20,534,288 bytes | 28.714 s |
| Optimized, Size | 17,615,832 bytes | 25.704 s |
| Optimized, Speed | 18,572,856 bytes | 20.179 s |

Each profile has one warm-payload publish observation using .NET SDK 10.0.401,
limited to two CPUs and 8 GiB RAM. Timing covers `dotnet publish` only, excluding
restore and packaging checks. Speed ran after Size and may reuse intermediates.
Both optimized profiles require GLIBC_2.38, within the supported 2.39 baseline.

**Default Size profile, matched warm launches**

| Workload | Build | First buffer | CPU, first 3 s | RSS | PSS | GPU memory |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 100 files, list | Before | 260.15 ms | 270 ms | 149.0 MiB | 85.7 MiB | 89 MiB |
| 100 files, list | Optimized | 257.02 ms | 260 ms | 147.1 MiB | 84.0 MiB | 89 MiB |
| 100,000 files, list | Before | 273.35 ms | 690 ms | 231.1 MiB | 168.8 MiB | 89 MiB |
| 100,000 files, list | Optimized | 270.51 ms | 630 ms | 215.4 MiB | 153.1 MiB | 89 MiB |
| 100,000 files, tiles | Before | 265.31 ms | 650 ms | 204.1 MiB | 141.6 MiB | 89 MiB |
| 100,000 files, tiles | Optimized | 262.98 ms | 580 ms | 185.6 MiB | 123.4 MiB | 89 MiB |
| Three 4096x4096 PNGs, preview open | Before | 261.75 ms | 1,440 ms | 421.6 MiB | 359.1 MiB | 153 MiB |
| Three 4096x4096 PNGs, preview open | Optimized | 248.98 ms | 880 ms | 409.9 MiB | 347.5 MiB | 93 MiB |

Image decoding still needs a temporary full raster. The optimized image case
reached a median process peak RSS of 490.1 MiB during the first five seconds.
Bounding preview dimensions reduces retained image and GPU data but does not
eliminate this decoding cost.

**Why Size remains the default**

| Workload | Size first buffer | Speed first buffer | Size CPU, first 3 s | Speed CPU, first 3 s |
| --- | ---: | ---: | ---: | ---: |
| 100 files, list | 257.02 ms | 255.84 ms | 260 ms | 260 ms |
| 100,000 files, list | 270.51 ms | 260.66 ms | 630 ms | 620 ms |
| 100,000 files, tiles | 262.98 ms | 271.74 ms | 580 ms | 600 ms |
| Three PNGs, preview open | 248.98 ms | 246.13 ms | 880 ms | 870 ms |

Speed adds 957,024 bytes (5.4%) with no consistent runtime advantage in these
cases. These runs do not establish a consistent startup improvement.

Measured on an AMD Ryzen 7 3700X, NVIDIA RTX 3080 with driver 615.71.09,
64 GiB RAM, Btrfs, and CachyOS Linux 7.2.7. Each value is the median of three
warm launches with alternating build order. Each build received one warmup
before each benchmark group (list, tiles, and images). Runs used a private
KWin Wayland compositor, a 1180x760 window,
1440x900 output at scale 1, and no Goo developer tools.

First buffer measures process launch to the first non-null Wayland buffer
attachment observed in the client trace. It includes trace delivery overhead
and does not measure presentation, directory readiness, or preview readiness.
CPU time covers approximately the first three seconds, with 10 ms accounting
resolution. RSS and PSS were sampled around five seconds. They exclude GPU
and compositor memory. GPU values are per-process samples, not peaks. Idle
CPU medians during the three-to-five-second interval were 0 to 0.5% of one core.
These shared-host, warm-cache results do not establish cold-start performance
or a ranking against other file managers.

Final source: `9fff806`, using public Goo and Goo.Svg 0.7.13,
Goo.Widgets 0.2.13, and Goo.Animations 0.2.5. Runtime measurements used the
same application code and Goo fix before package publication. The final
executables have identical executable code and runtime data, with differences
limited to module identifiers, native build paths, and debug/build metadata.
The exact public-package Size executable also passed the full Wayland visual,
selection, and local file-operation checks.

</details>

## Links

- [Downloads and release notes](https://github.com/obselate/gloop/releases)
- [Goo UI framework](https://github.com/obselate/goo)
- [Report an issue](https://github.com/obselate/gloop/issues)
- [MIT license](LICENSE)
