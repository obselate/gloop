#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gsharp_commit="99735b06678c353bb918980970513ebcf1ac1019"
gsharp_version="0.4.1094-g99735b0667"
gsharp_dir="$repo_root/artifacts/toolchain/gsharp"
feed_dir="$repo_root/artifacts/feed"
gslint_hash="b1681bac5dbd18ef92d68da12c1afd5e67fbb08ff7d44f74e035758457637775"

cd "$repo_root"
mkdir -p "$feed_dir" "$repo_root/artifacts/toolchain"
printf '%s  %s\n' "$gslint_hash" "$repo_root/deps/nuget/Gslint.0.1.0-g44e43c0.nupkg" | sha256sum --check --status

if [[ ! -f "$feed_dir/Gsharp.NET.Sdk.$gsharp_version.nupkg" ]]; then
    if [[ ! -d "$gsharp_dir/.git" ]]; then
        git clone --quiet https://github.com/DavidObando/gsharp.git "$gsharp_dir"
    fi
    git -C "$gsharp_dir" checkout --quiet --detach "$gsharp_commit"
    [[ "$(git -C "$gsharp_dir" rev-parse HEAD)" == "$gsharp_commit" ]]
    dotnet restore "$gsharp_dir/GSharp.sln" --locked-mode --configfile "$gsharp_dir/nuget.config"
    dotnet pack "$gsharp_dir/src/Sdk/Gsharp.NET.Sdk/Gsharp.NET.Sdk.csproj" \
        --configuration Release --no-restore \
        -p:GeneratePackageOnBuild=false --output "$feed_dir"
    [[ -f "$feed_dir/Gsharp.NET.Sdk.$gsharp_version.nupkg" ]]
fi

dotnet tool restore --configfile "$repo_root/NuGet.Config"
