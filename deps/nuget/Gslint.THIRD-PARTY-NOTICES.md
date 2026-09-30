# Third-Party Notices

## GSharp.Core and GSharp.Formatting

gslint vendors unmodified `GSharp.Core.dll`, `GSharp.Core.xml`, and `GSharp.Formatting.dll`, from [G# commit 947be9cb](https://github.com/DavidObando/gsharp/tree/947be9cb5f4467947ecb95dba06b461f9984d659).
The parser and native analyzer APIs come from `src/Core/Core.csproj`.
The canonical ADR-0179 formatter comes from
`src/Formatting/GSharp.Formatting/GSharp.Formatting.csproj`.
Both assemblies support ADR-0180 mixed initializers.

Build both projects with `dotnet build <project> -c Release`. Copy their DLL and
XML outputs from `out/bin/Release/<project>/` to `vendor/gsharp/`.
The upstream source uses the MIT license, Copyright (C) GSharp Authors.
See [upstream LICENSE](https://github.com/DavidObando/gsharp/blob/947be9cb5f4467947ecb95dba06b461f9984d659/LICENSE).

The old copied language-server `FormattingEngine.cs` has been removed.
See `LICENSE` for gslint's own MIT license terms.
