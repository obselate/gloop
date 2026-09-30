#!/usr/bin/env bash
set -euo pipefail

profile="${1:-Size}"
max_glibc="${GLOOP_MAX_GLIBC:-2.39}"
if [[ "${GITHUB_ACTIONS:-}" == true && "$max_glibc" != 2.39 ]]; then
  printf 'GLOOP_MAX_GLIBC may only be overridden for local measurements\n' >&2
  exit 1
fi
case "$profile" in
  Speed|Size) ;;
  *) printf 'usage: %s [Speed|Size]\n' "$0" >&2; exit 2 ;;
esac

repo="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
output="$repo/artifacts/publish/$profile"
dist="$repo/artifacts/dist/$profile"
for tool in dotnet file find mktemp readelf rg; do
  command -v "$tool" >/dev/null || { printf 'missing required tool: %s\n' "$tool" >&2; exit 1; }
done

mkdir -p "$output" "$dist"
bash "$repo/scripts/bootstrap.sh"
dotnet restore "$repo/gloop.gsproj" -r linux-x64 --locked-mode --configfile "$repo/NuGet.Config" -p:PublishAot=true
start="$(date +%s%N)"
dotnet publish "$repo/gloop.gsproj" -c Release -r linux-x64 --self-contained true \
  --no-restore -o "$output" \
  -p:PublishAot=true -p:OptimizationPreference="$profile" -p:StripSymbols=true
elapsed="$(( ($(date +%s%N) - start) / 1000000 ))"

binary="$output/gloop"
[[ -x "$binary" ]] || { printf 'NativeAOT executable is missing: %s\n' "$binary" >&2; exit 1; }
file "$binary" | rg -q 'ELF 64-bit.*executable|ELF 64-bit.*pie executable'
mapfile -t required_libraries < <(
  readelf -d "$binary" | sed -nE 's/.*Shared library: \[([^]]+)\].*/\1/p'
)
for library in "${required_libraries[@]}"; do
  case "$library" in
    libc.so.6|libm.so.6|ld-linux-x86-64.so.2|libdl.so.2|libpthread.so.0|librt.so.1|libgcc_s.so.1) ;;
    *) printf 'NativeAOT executable requires an unbundled library: %s\n' "$library" >&2; exit 1 ;;
  esac
done
highest_glibc="$(readelf --version-info "$binary" | sed -nE 's/.*Name: GLIBC_([0-9]+\.[0-9]+).*/\1/p' | sort -Vu | tail -n 1)"
if [[ -z "$highest_glibc" || "$(printf '%s\n%s\n' "$max_glibc" "$highest_glibc" | sort -V | tail -n 1)" != "$max_glibc" ]]; then
  printf 'NativeAOT executable requires GLIBC %s, above allowed %s\n' "$highest_glibc" "$max_glibc" >&2
  exit 1
fi

staged_binary="$(mktemp "$dist/.gloop.XXXXXX")"
trap 'rm -f -- "$staged_binary"' EXIT
install -m 0755 "$binary" "$staged_binary"
mv -f -- "$staged_binary" "$dist/gloop"
extra_output="$(find "$dist" -mindepth 1 -maxdepth 1 ! -name gloop -print -quit)"
if [[ -n "$extra_output" ]]; then
  printf 'NativeAOT distribution contains an unexpected file: %s\n' "$extra_output" >&2
  exit 1
fi
expected_version="$(dotnet msbuild "$repo/gloop.gsproj" -getProperty:Version -nologo)"
reported_version="$("$dist/gloop" --version)"
if [[ "$reported_version" != "gloop $expected_version" ]]; then
  printf 'NativeAOT executable reported version %q; expected %q\n' \
    "$reported_version" "gloop $expected_version" >&2
  exit 1
fi
licenses="$("$dist/gloop" --licenses)"
if [[ -z "$licenses" ]]; then
  printf 'NativeAOT executable returned no embedded license notices\n' >&2
  exit 1
fi
printf 'profile=%s publish_ms=%s glibc=%s bytes=%s sha256=' "$profile" "$elapsed" "$highest_glibc" "$(stat -c %s "$dist/gloop")"
sha256sum "$dist/gloop" | cut -d ' ' -f 1
