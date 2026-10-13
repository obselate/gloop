package gloop

import Goo
import Goo.Widgets
import System
import System.Collections.Generic
import System.IO
import System.Text.RegularExpressions

partial class BrowserView {
    private var bulkOptions BulkRenameOptions = BulkRenameOptions()
    private var bulkSources List[string] = List[string]()
    private var bulkNames List[string] = List[string]()
    private var bulkResults List[OperationResult]?
    private var bulkBusy bool

    private func OpenBulkRename() {
        bulkSources = Model.ActivePane().SelectionPaths()
        bulkOptions = BulkRenameOptions()
        bulkResults = nil
        bulkBusy = false

        OpenDialog(DialogKind.BulkRename, "")
        UpdateBulkPreview()
    }

    private func UpdateBulkPreview() {
        dialogError = ""
        bulkNames = List[string]()

        try {
            bulkNames = bulkOptions.Names(bulkSources)
            FileOperationService().ValidateRenames(bulkSources, bulkNames)
        } catch (failure Exception) when failure is IOException ||
            failure is ArgumentException ||
            failure is RegexMatchTimeoutException {
            dialogError = if failure is RegexMatchTimeoutException {
                "Rename preview failed: the regular expression took too long"
            } else {
                failure.Message
            }
        }

        Rebuild()
    }

    private func BulkField(
        label string,
        value string,
        change Action[string],
        handle ElementHandle? = nil
    ) Blob -> Container{
        FlexShrink: 0,
        MinWidth: 0,
        Gap: 4,
        Ui.Label(label, palette.Muted, 12),
        TextField.Build(
            value,
            next -> {
                change(next)
                UpdateBulkPreview()
            },
            (_) -> SubmitBulkRename(),
            label,
            palette,
            handle: handle,
            autoFocus: handle != nil
        ),
    }

    private func BulkRenameDialog() Blob {
        let p = palette
        let rows = List[Blob]()

        if !bulkBusy && bulkResults == nil {
            rows.Add(
                Text{
                    Content: "Changes apply to the full name, including its extension. Numbering follows selection order.",
                    Color: p.Muted,
                    FontSize: 12,
                    TextWrap: TextWrap.Wrap
                }
            )
            rows.Add(BulkField("Find", bulkOptions.Find, value -> bulkOptions.Find = value, dialogInput))
            rows.Add(BulkField("Replace with", bulkOptions.Replace, value -> bulkOptions.Replace = value))
            rows.Add(
                Container{
                    FlexDirection: width < 560 ? FlexDirection.Column: FlexDirection.Row,
                    Gap: 8,
                    DialogButton(
                        bulkOptions.UseRegex ? "Regex: on": "Regex: off",
                        () -> {
                            bulkOptions.UseRegex = !bulkOptions.UseRegex
                            UpdateBulkPreview()
                        },
                        p
                    ),
                    DialogButton(
                        "Case: " + bulkOptions.Case,
                        () -> {
                            bulkOptions.Case = switch bulkOptions.Case {
                                case "Keep case": "lowercase"
                                case "lowercase": "UPPERCASE"
                                default: "Keep case"
                            }
                            UpdateBulkPreview()
                        },
                        p
                    ),
                }
            )
            rows.Add(
                BulkField(
                    "Numbered pattern (optional), e.g. name-{n}.txt",
                    bulkOptions.Pattern,
                    value -> bulkOptions.Pattern = value
                )
            )
            rows.Add(
                Container{
                    FlexDirection: FlexDirection.Row,
                    Gap: 12,
                    Container{
                        FlexGrow: 1,
                        FlexBasis: 0,
                        MinWidth: 0,
                        BulkField("Start", bulkOptions.Start, value -> bulkOptions.Start = value)
                    },
                    Container{
                        FlexGrow: 1,
                        FlexBasis: 0,
                        MinWidth: 0,
                        BulkField("Padding", bulkOptions.Padding, value -> bulkOptions.Padding = value)
                    },
                }
            )
        }

        if dialogError != "" {
            rows.Add(Ui.ErrorText(dialogError, p))
        }

        rows.Add(Ui.Label("Old name → New name", p.Text, 13, 600))

        for index in 0 ... bulkSources.Count {
            let source = bulkSources[index]
            let oldName = Path.GetFileName(source)
            let name = index < bulkNames.Count ? bulkNames[index]: oldName
            var outcome = name == oldName ? "Unchanged, skipped": ""

            if let results = bulkResults {
                for result in results {
                    if result.Source == source {
                        outcome = result.Error == "" ? "Renamed": "Rename failed: " + result.Error
                        break
                    }
                }
            }

            rows.Add(
                Container{
                    FlexShrink: 0,
                    MinWidth: 0,
                    Gap: 4,
                    Padding: Edges{Top: 6, Bottom: 6},
                    BorderWidth: Edges{Bottom: 1},
                    BorderColor: p.Border,
                    Text{Content: oldName + " → " + name, Color: p.Text, FontSize: 13, TextWrap: TextWrap.Wrap},
                    Text{
                        Content: outcome,
                        Color: outcome.StartsWith("Rename failed:", StringComparison.Ordinal) ? p.Error: p.Muted,
                        FontSize: 12,
                        TextWrap: TextWrap.Wrap
                    },
                }
            )
        }

        let actions = Container{FlexDirection: FlexDirection.Row, JustifyContent: JustifyContent.FlexEnd, Gap: 8}
        actions.Children.Add(DialogButton(bulkResults != nil ? "Close": "Cancel", () -> CloseDialog(), p))

        if !bulkBusy && bulkResults == nil && dialogError == "" && !Model.Operations.IsOperating {
            actions.Children.Add(DialogButton("Rename selection", () -> SubmitBulkRename(), p, true))
        }

        return DialogShell.Build(
            "Bulk rename" + (bulkBusy ? " · Working…": ""),
            DialogShell.ScrollColumn(rows.ToArray(), p, 8, Math.Clamp(height * .88 - 150, 160, 620)),
            actions,
            dialogHandle,
            () -> CloseDialog(),
            HandleKey,
            WidgetKeyBindings.Editing(window?.PlatformInput),
            Host,
            p,
            720,
            height < 600,
            bulkBusy
        )
    }

    private func SubmitBulkRename() {
        if bulkBusy || bulkResults != nil || Model.Operations.IsOperating {
            return
        }

        UpdateBulkPreview()

        if dialogError != "" {
            return
        }

        let sources = List[string]()
        let names = List[string]()

        for index in 0 ... bulkSources.Count {
            if Path.GetFileName(bulkSources[index]) != bulkNames[index] {
                sources.Add(bulkSources[index])
                names.Add(bulkNames[index])
            }
        }

        if sources.Count == 0 {
            dialogError = "No names changed. Unchanged items are skipped."
            Rebuild()
            return
        }

        bulkBusy = true
        Model.Operations.StartOperation(
            OperationKind.BulkRename,
            sources,
            "",
            "",
            completed: (results List[OperationResult]) -> {
                bulkBusy = false
                bulkResults = results
                var failed int32

                for result in results {
                    if result.Error != "" {
                        failed++
                    }
                }

                dialogError = (results.Count - failed).ToString() + " renamed, " + failed.ToString() + " failed."
            },
            names: names
        )
    }
}
