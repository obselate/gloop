#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
gslint_hash="b1681bac5dbd18ef92d68da12c1afd5e67fbb08ff7d44f74e035758457637775"

cd "$repo_root"
printf '%s  %s\n' "$gslint_hash" "$repo_root/deps/nuget/Gslint.0.1.0-g44e43c0.nupkg" | sha256sum --check --status

dotnet tool restore --configfile "$repo_root/NuGet.Config"
