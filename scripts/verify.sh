#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

bash scripts/bootstrap.sh

dotnet tool run gslint -- --strict src
dotnet restore gloop.gsproj --locked-mode --configfile NuGet.Config
dotnet build gloop.gsproj --configuration Release --no-restore -warnaserror
