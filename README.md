# <img src="assets/gloop.png" width="48" height="48" alt=""> Gloop

A keyboard-first file manager for Linux and Wayland. Built with G# and Goo.

## Quick start

Download the [Linux release](https://github.com/obselate/gloop/releases/latest),
extract it, and run `./gloop`.

One executable. No .NET runtime or extra application packages to install.

Run `./gloop --install-desktop` to install it in `~/.local/bin` and add the
application launcher and icon. Run `./gloop --set-default` to also make Gloop
the default application for opening folders. Save and extraction destination
dialogs use the calling application's file chooser or desktop portal.

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

## Platforms

Linux x86-64 with glibc 2.39 or newer, a native Wayland session, and Vulkan 1.3
drivers. The same release works across compatible Linux distributions.

## Build from source

<details>
<summary>Developer setup and commands</summary>

Install [.NET SDK 10.0.401](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
Git, Clang, zlib development headers, binutils, file, and ripgrep.

```sh
git clone https://github.com/obselate/gloop.git
cd gloop
bash scripts/verify.sh
dotnet run
```

The verification script fetches the pinned public G# compiler and restores
locked NuGet packages. No sibling repositories are needed.

To build the single-file NativeAOT executable on Ubuntu 24.04:

```sh
bash scripts/publish.sh
```

The executable is written to `artifacts/dist/Size/gloop`.

</details>

## Performance

<details>
<summary>Recorded benchmarks and hardware</summary>

Measured on an AMD Ryzen 7 3700X, NVIDIA RTX 3080, 64 GiB RAM, Btrfs,
and CachyOS Linux 7.2.7. These are warm-cache measurements on a shared host.
The tables identify the measured versions. These are historical results.

**Gloop 0.4.0 memory:** NativeAOT Size, Goo 0.7.8, private KWin Wayland,
1180x760 window. Median of three fresh launches per zero-byte-file fixture,
sampled for 15 seconds in list mode. Preview and split were off.

| Files | Process PSS | Process RSS |
| ---: | ---: | ---: |
| 0 | 85.1 MiB | 148.5 MiB |
| 100 | 87.6 MiB | 151.1 MiB |
| 10,000 | 100.4 MiB | 163.8 MiB |
| 100,000 | 177.9 MiB | 241.2 MiB |

PSS apportions shared resident memory. RSS counts each process's resident
mappings. Both exclude GPU and compositor memory. Image and text previews
can raise memory above these directory-only figures.

**Gloop 0.3.0 candidate versus Flea 0.3.6:** local Goo 0.7.4, Hyprland 0.56.2,
1398x858 windows, NVIDIA driver 615.71.09. Median of three alternating warm
launches after one warmup per app and fixture. Flea used Quickshell 0.3.1 and
pinned Omarchy modules and theme.

| Files | App | First frame feedback | Startup CPU | PSS | RSS | CPU 1.5 to 3.5 s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 0 | Gloop | 336.4 ms | 263.7 ms | 87.1 MiB | 148.0 MiB | 3.6 ms |
| 0 | Flea | 636.4 ms | 641.4 ms | 147.7 MiB | 251.4 MiB | 2.5 ms |
| 10,000 | Gloop | 397.8 ms | 303.8 ms | 98.3 MiB | 159.3 MiB | 2.6 ms |
| 10,000 | Flea | 624.0 ms | 623.1 ms | 158.7 MiB | 262.5 MiB | 2.3 ms |
| 100,000 | Gloop | 344.0 ms | 665.9 ms | 170.2 MiB | 231.3 MiB | 2.2 ms |
| 100,000 | Flea | 524.8 ms | 688.0 ms | 160.9 MiB | 264.8 MiB | 2.4 ms |

First frame feedback includes Wayland tracing and delivery to the harness.
It does not measure directory readiness. A separate untraced pass measured
CPU over startup's first 1.5 seconds, memory at 3.5 seconds, and CPU time
over the intervening 2 seconds. Both apps used the same systemd scope launcher.
Memory and CPU include Flea's backend, frontend, and trash monitor.
A resident inference server remained running. These results do not establish
a general speed ranking or cold-start performance.

**Gloop 0.4.0 publishing:** Ubuntu 24.04, build limited to two CPU cores and
8 GiB RAM. One publish observation per profile, separate from runtime.

| NativeAOT profile | Executable | Publish time |
| --- | ---: | ---: |
| Size | 19,688,240 bytes | 22.855 s |
| Speed | 20,534,864 bytes | 24.032 s |

**Earlier managed Release processing benchmarks:** same Ryzen 7 3700X host.
These measure individual stages, not complete UI interactions.

| Workload | Before | After |
| --- | ---: | ---: |
| Directory listing and view processing, 10,000 files | 43.96 ms | 40.35 ms |
| Directory listing and view processing, 100,000 files | 347.57 ms | 309.82 ms |
| Same 100,000 files, filter with one match | 340.63 ms | 286.96 ms |
| DataGrid build, 100,000 rows, selection near start | 11,376 us | 93 us |
| DataGrid build, 100,000 rows, selection at end | 12,801.5 us | 1,268 us |
| DataGrid allocation per unchanged-row build | 10,633,472 bytes | 7,864 bytes |

Directory results are medians of 14 samples, with each process's first
iteration discarded. DataGrid results compare Goo Widgets 0.2.8 and 0.2.9,
with 60 builds per case after three warmups in each of three processes.

</details>

## Further reading

- [Downloads and release notes](https://github.com/obselate/gloop/releases)
- [Goo UI framework](https://github.com/obselate/goo)
- [Report an issue](https://github.com/obselate/gloop/issues)
- [MIT license](LICENSE)
