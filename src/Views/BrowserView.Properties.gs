package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import System
import System.Collections.Generic
import System.Globalization
import System.IO

partial class BrowserView {
    private var propertiesPaths List[string] = List[string]()
    private var propertiesInfo FileProperties = FileProperties{}
    private var propertiesStage int32
    private var permissionError string = ""

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
        permissionError = ""

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

            if propertiesStage == 2 && info.Permissions != "" {
                if info.IsLink {
                    rows.Add(PropertiesRow("Editing", "Symbolic link permissions are read-only"))
                } else {
                    let uid = PropertiesService.EffectiveUserId()
                    let canEdit = uid == 0 || uid == info.OwnerId
                    rows.Add(PermissionRow("Owner", 6, canEdit))
                    rows.Add(PermissionRow("Group", 3, canEdit))
                    rows.Add(PermissionRow("Other", 0, canEdit))

                    if !canEdit {
                        rows.Add(Ui.Label("Only the owner can change permissions", p.Muted, 13))
                    }
                }
            }
        }

        if propertiesStage == 2 && info.Error != "" {
            rows.Add(Ui.ErrorText(info.Error, p))
        }

        if permissionError != "" {
            rows.Add(Ui.ErrorText(permissionError, p))
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

    private func PermissionRow(label string, shift int32, canEdit bool) Blob {
        let controls = List[Blob](3)
        let names = []string{"Read", "Write", "Execute"}

        for index in 0 ... 3 {
            let bit = UnixFileMode((4 >> index) << shift)
            let checkbox = Checkbox{
                Label: names[index],
                AccessibilityName: label + " " + names[index].ToLowerInvariant(),
                State: (propertiesInfo.Mode & bit) != UnixFileMode.None ?
                AccessibilityChecked.True: AccessibilityChecked.False,
                Disabled: !canEdit || Model.Operations.IsOperating || !Model.Operations.AcceptingOperations,
                OnChange: state -> ChangePermission(bit, state == AccessibilityChecked.True),
                LabelColor: palette.Text,
                LabelFontSize: 13,
                Size: 16,
                BackgroundColor: palette.Surface,
                BorderColor: palette.Border,
                CheckedBackgroundColor: palette.Accent,
                CheckedBorderColor: palette.Accent,
                MarkColor: palette.Background,
            }.Build()
            checkbox.Focus = palette.Ring(2, 2)
            controls.Add(checkbox)
        }

        return Container{
            FlexDirection: FlexDirection.Row,
            Gap: 8,
            Container{Width: 96, FlexShrink: 0, Ui.Label(label, palette.Muted, 13)},
            Container{FlexDirection: FlexDirection.Row, Gap: 12, Children: controls.ToArray()},
        }
    }

    private func ChangePermission(bit UnixFileMode, enabled bool) {
        let paths = propertiesPaths
        permissionError = ""

        Model.Operations.StartOperation(
            OperationKind.Permissions,
            paths[0],
            "",
            "",
            completed: (results List[OperationResult]) -> {
                if dialog != DialogKind.Properties || !Object.ReferenceEquals(propertiesPaths, paths) {
                    return
                }

                let result = results[0]

                if let mode = result.Mode {
                    propertiesInfo.Mode = mode
                    propertiesInfo.Permissions = PropertiesService.Permissions(mode)
                }

                permissionError = result.Error == "" ?
                "": "Change permissions failed for " + paths[0] + ": " + result.Error
                Rebuild()
            },
            permission: bit,
            enabled: enabled
        )
    }

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
