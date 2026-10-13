package gloop

import Goo
import Goo.Widgets
import System
import System.Collections.Generic
import System.Globalization
import System.IO

partial class BrowserView {
    private var propertiesPaths List[string] = List[string]()
    private var propertiesInfo FileProperties = FileProperties{}
    private var propertiesStage int32

    private func OpenProperties() {
        let paths = Model.ActivePane().SelectionPaths()
        if paths.Count == 0 {
            let folder = Model.ActivePane().DirectoryPath
            if folder == "" || Model.InRecent {
                return
            }
            paths.Add(folder)
        }
        propertiesPaths = paths
        propertiesInfo = FileProperties{Count: paths.Count}
        propertiesStage = 0
        Selection.Describe(
            paths,
            early -> {
                propertiesInfo = early
                propertiesStage = 1
                Rebuild()
            },
            result -> {
                propertiesInfo = result
                propertiesStage = 2
                Rebuild()
            }
        )
        OpenDialog(DialogKind.Properties, "")
    }

    private func PropertiesDialog() Blob {
        let p = palette
        let info = propertiesInfo
        let single = propertiesPaths.Count == 1
        let first = propertiesPaths[0]
        let wait = "…"
        let rows = List[Blob]()
        rows.Add(
            PropertiesRow(
                "Name",
                single ? (info.Name != "" ? info.Name: PathName(first)): info.Count.ToString() + " items"
            )
        )
        if single {
            rows.Add(PropertiesRow("Kind", propertiesStage >= 1 ? info.Kind: wait))
            rows.Add(PropertiesRow("Type", propertiesStage >= 1 ? info.MimeType: wait))
            if info.LinkTarget != "" {
                rows.Add(PropertiesRow("Link target", info.LinkTarget))
            }
            rows.Add(PropertiesRow("Location", Path.GetDirectoryName(first) ?? "/"))
        } else {
            rows.Add(
                PropertiesRow(
                    "Location",
                    propertiesStage == 2 ? (info.Location != "" ? info.Location: "Several folders"): wait
                )
            )
        }
        rows.Add(PropertiesRow("Size", propertiesStage == 2 ? SizeText(info): "Calculating…"))
        if single {
            rows.Add(
                PropertiesRow(
                    "Modified",
                    propertiesStage >= 1 ? FileEntry.FormatDate(info.Modified, CultureInfo.InvariantCulture): wait
                )
            )
            if propertiesStage >= 1 && info.Created != DateTime.MinValue {
                rows.Add(PropertiesRow("Created", FileEntry.FormatDate(info.Created, CultureInfo.InvariantCulture)))
            }
            rows.Add(PropertiesRow("Permissions", propertiesStage >= 1 ? info.Permissions: wait))
            rows.Add(PropertiesRow("Owner / Group", propertiesStage >= 1 ? info.Owner + " / " + info.Group: wait))
        }
        if propertiesStage == 2 && info.Error != "" {
            rows.Add(Ui.ErrorText(info.Error, p))
        }
        return DialogShell.Build(
            DialogTitle(dialog),
            DialogShell.ScrollColumn(rows.ToArray(), p, 6),
            Container{
                FlexDirection: FlexDirection.Row,
                JustifyContent: JustifyContent.FlexEnd,
                DialogButton("Close", () -> CloseDialog(), p, true),
            },
            dialogHandle,
            () -> CloseDialog(),
            HandleKey,
            WidgetKeyBindings.Editing(window?.PlatformInput),
            Host,
            p,
            460
        )
    }

    private func PropertiesRow(label string, value string) Blob -> PropertyRow.Build(
        label,
        value,
        palette,
        96,
        13,
        true
    )

    private func PathName(path string) string {
        let name = Path.GetFileName(Path.TrimEndingDirectorySeparator(path))
        return name == "" ? path: name
    }

    private func SizeText(info FileProperties) string {
        var text = FileSystemService.FormatSize(info.Size)
        if info.Items > 0 || info.Kind == "Folder" {
            text += " · " + info.Items.ToString("N0", CultureInfo.InvariantCulture) +
                (info.Items == 1 ? " item": " items")
        }
        return info.Complete ? text: text + " (incomplete)"
    }
}
