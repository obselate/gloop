# Build Gloop

Use Linux x86-64, a native Wayland session and working Vulkan 1.3 drivers.
Published binaries support glibc 2.39 or newer.

Install [.NET SDK 10.0.401](https://dotnet.microsoft.com/en-us/download/dotnet/10.0),
the exact version pinned in [global.json](global.json).
On Ubuntu 24.04, install the build tools used by the release workflow:

```sh
sudo apt-get update
sudo apt-get install -y clang zlib1g-dev binutils file ripgrep git python3
```

## Build and run

```sh
git clone https://github.com/obselate/gloop.git
cd gloop
bash scripts/verify.sh
dotnet run
```

The verification script fetches and builds the pinned public G# compiler,
restores locked packages, runs strict lint and builds Release with warnings
as errors. No sibling repositories are needed. The first build needs internet
access to GitHub and NuGet.

## Publish one executable

Build distributable Linux binaries on Ubuntu 24.04:

```sh
bash scripts/publish.sh Size
```

The NativeAOT executable is `artifacts/dist/Size/gloop`. It needs no .NET runtime.
The script checks the ELF format, shared-library dependencies and glibc limit
of 2.39, then reports publish time, binary size and SHA-256.
