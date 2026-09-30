# <img src="assets/gloop.png" width="48" height="48" alt=""> Gloop

**0.5.0**

A keyboard-first file manager for Linux and Wayland. Built with G# and Goo.

## Install on Linux

[Download the latest Linux x64 release](https://github.com/obselate/gloop/releases/latest), or run:

```sh
curl -fLO https://github.com/obselate/gloop/releases/latest/download/gloop-linux-x64.tar.gz
tar -xzf gloop-linux-x64.tar.gz
./gloop --install-desktop
```

Open Gloop from your application menu or run `~/.local/bin/gloop ~/Documents`.
The archive contains one executable. Requires glibc 2.39 or newer, Wayland,
and Vulkan drivers. No .NET runtime is needed. Release downloads include
`SHA256SUMS`. Use `gloop --licenses` to read the embedded third-party notices.

## Build from source

Install [.NET SDK 10.0.401](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
Git, Clang, zlib development headers, binutils, file, and ripgrep.
On Ubuntu 24.04, the native prerequisites are:

```sh
sudo apt install git clang zlib1g-dev binutils file ripgrep
git clone https://github.com/obselate/gloop.git
cd gloop
bash scripts/verify.sh
bash scripts/publish.sh
./artifacts/dist/Size/gloop ~/Documents
```

The build fetches the pinned public G# compiler and restores locked NuGet
packages. No sibling repositories are needed. For development, use
`dotnet run --project gloop.gsproj -- ~/Documents` after verification.
Publish on Ubuntu 24.04 for the release glibc baseline. Linux x64 releases
use NativeAOT with Size optimization and are built from annotated
`v<Version>` tags on `main`. [MIT license](LICENSE).

## Features

- List and tile views with image thumbnails, sorting, and filename filters.
- Mouse and keyboard multi-selection, filename prefix selection, and rebindable shortcuts.
- Image and text previews with syntax highlighting. Toggle with Space.
- Optional split browsing. Toggle with Ctrl+S.
- Create folders, rename, copy, move, Trash, and drag files between panes or applications.
- Folder bookmarks, terminal launch with F4, theme presets, and saved preferences.

Copy works across filesystems. Cross-filesystem move and Trash report an error
and preserve the source. Remote filesystems are not implemented.

## Performance

Measured on an AMD Ryzen 7 3700X, NVIDIA RTX 3080, 64 GiB RAM, Btrfs,
and CachyOS Linux 7.2.7. These are warm-cache measurements on a shared host.
The tables identify the measured versions, rather than predicting 0.5.0 results.

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
