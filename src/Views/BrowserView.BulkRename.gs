package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO
import System.Text.RegularExpressions

partial class BrowserView {
    private var bulkOptions BulkRenameOptions = BulkRenameOptions()
    private var bulkSources List[string] = List[string]()
    private var bulkNames List[string] = List[string]()
    private var bulkErrors List[string] = List[string]()
    private var bulkResults List[OperationResult]?
    private var bulkBusy bool
    private var bulkSummary string = ""
    private let bulkInputs Dictionary[string, ElementHandle] = Dictionary[string, ElementHandle]()

    private func OpenBulkRename() {
        bulkSources = Model.ActivePane().SelectionPaths()
        bulkOptions = BulkRenameOptions()
        bulkResults = nil
        bulkBusy = false
        bulkSummary = ""

        OpenDialog(DialogKind.BulkRename, "")
        UpdateBulkPreview()
    }

    private func UpdateBulkPreview() {
        dialogError = ""
        bulkNames = List[string]()
        bulkErrors = List[string]()

        try {
            bulkNames = bulkOptions.Names(bulkSources)
            bulkErrors = FileOperationService().RenameErrors(bulkSources, bulkNames)

            for error in bulkErrors {
                if error != "" {
                    dialogError = error
                    break
                }
            }
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

    private func BulkField(label string, value string, change Action[string], handle ElementHandle? = nil) Blob {
        if !bulkInputs.TryGetValue(label, out var input) {
            input = handle ?? ElementHandle()
            bulkInputs[label] = input
        }

        let field = TextField.Build(
            value,
            next -> {
                change(next)
                UpdateBulkPreview()
            },
            (_) -> SubmitBulkRename(),
            label,
            palette,
            handle: input,
            autoFocus: handle != nil
        )
        field.OnFocus = (_) -> input.ScrollIntoView()

        return Container{FlexShrink: 0, MinWidth: 0, Gap: 4, Ui.Label(label, palette.Muted, 12), field}
    }

    private func BulkRenameControls(p Palette) Blob {
        let options = []ComboBoxOption{
            ComboBoxOption{Id: "Keep", Label: "Keep", Content: Ui.Label("Keep", p.Text, 13)},
            ComboBoxOption{Id: "lowercase", Label: "lowercase", Content: Ui.Label("lowercase", p.Text, 13)},
            ComboBoxOption{Id: "UPPERCASE", Label: "UPPERCASE", Content: Ui.Label("UPPERCASE", p.Text, 13)},
        }

        return Container{
            FlexDirection: FlexDirection.Row,
            AlignItems: AlignItems.Center,
            Gap: 12,
            Container{
                FlexGrow: 1,
                MinWidth: 0,
                Checkbox{
                    Label: "Regular expression",
                    State: bulkOptions.UseRegex ? AccessibilityChecked.True: AccessibilityChecked.False,
                    OnChange: state -> {
                        bulkOptions.UseRegex = state == AccessibilityChecked.True
                        UpdateBulkPreview()
                    },
                    LabelColor: p.Text,
                    LabelFontSize: 12,
                    Size: 16,
                    BackgroundColor: p.Surface,
                    BorderColor: p.Border,
                    CheckedBackgroundColor: p.Accent,
                    CheckedBorderColor: p.Accent,
                    MarkColor: p.Background,
                }.Build(),
            },
            Container{
                Gap: 4,
                Ui.Label("Case", p.Muted, 12),
                Cell.Mount[ComboBoxInput, ComboBox](
                    "bulk-case",
                    ComboBoxInput{
                        Items: options,
                        SelectedId: bulkOptions.Case,
                        OnSelect: value -> {
                            bulkOptions.Case = value
                            UpdateBulkPreview()
                        },
                        AccessibilityName: "Case",
                        OverlayHost: rootHandle,
                        Width: 160,
                        RowHeight: 30,
                        CreateTrigger: (_, row) -> {
                            row.BasedOn = TextField.FieldStyle(p)
                            row.Focus = p.FocusBorder()
                            return row
                        },
                        CreatePopup: (_, panel) -> {
                            panel.BasedOn = p.PopupStyle()
                            return panel
                        },
                        CreateRow: (input, item, row) -> {
                            row.BackgroundColor = input.SelectedId == item.Id ? p.Selection: Color.Transparent
                            row.Hover = Style{BackgroundColor: p.Selection}
                            return row
                        },
                    }
                ),
            },
        }
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
            rows.Add(BulkRenameControls(p))
            rows.Add(
                BulkField(
                    "Numbered pattern (optional), e.g. photo-{n}{ext}",
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

        if bulkSummary != "" {
            rows.Add(Ui.Label(bulkSummary, p.Muted, 12))
        }

        rows.Add(Ui.Label("Old name → New name", p.Text, 13, 600))
        BulkPreviewRows(rows, p)

        let actions = Container{FlexDirection: FlexDirection.Row, JustifyContent: JustifyContent.FlexEnd, Gap: 8}
        actions.Children.Add(DialogButton(bulkResults != nil ? "Close": "Cancel", () -> CloseDialog(), p))

        if bulkResults == nil {
            actions.Children.Add(
                DialogButton(
                    "Rename selection",
                    () -> SubmitBulkRename(),
                    p,
                    true,
                    bulkBusy || dialogError != "" || Model.Operations.IsOperating
                )
            )
        }

        return DialogShell.Build(
            "Bulk rename" + (bulkBusy ? " · Working…": ""),
            DialogShell.ScrollColumn(
                rows.ToArray(),
                p,
                8,
                Math.Min(
                    (bulkBusy || bulkResults != nil ? 60: 380) + bulkSources.Count * 26,
                    Math.Clamp(height * .88 - 150, 160, 620)
                )
            ),
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

    private func BulkPreviewRows(rows List[Blob], p Palette) {
        let preview = Container{FlexShrink: 0, MinWidth: 0, Gap: 0, Padding: Edges{Top: 4}}
        rows.Add(preview)

        for index in 0 ... bulkSources.Count {
            let source = bulkSources[index]
            let oldName = Path.GetFileName(source)
            let name = index < bulkNames.Count ? bulkNames[index]: oldName
            let invalid = index < bulkErrors.Count && bulkErrors[index] != ""
            var status = name == oldName ? " (skipped)": ""
            var failure = ""

            if let results = bulkResults {
                for result in results {
                    if result.Source == source {
                        status = result.Error == "" ? " (renamed)": ""
                        failure = result.Error
                        break
                    }
                }
            }

            preview.Children.Add(
                Container{
                    FlexShrink: 0,
                    MinWidth: 0,
                    Height: 26,
                    FlexDirection: FlexDirection.Row,
                    AlignItems: AlignItems.Center,
                    Gap: 6,
                    Text{
                        Content: oldName + " →",
                        Color: invalid ? p.Error: p.Muted,
                        FontSize: 13,
                        FlexGrow: 1,
                        FlexBasis: 0,
                        MinWidth: 0,
                        TextWrap: TextWrap.NoWrap,
                        TextTrimming: TextTrimming.Ellipsis
                    },
                    Text{
                        Content: name + status,
                        Color: invalid ? p.Error: p.Text,
                        FontSize: 13,
                        FlexGrow: 1,
                        FlexBasis: 0,
                        MinWidth: 0,
                        TextWrap: TextWrap.NoWrap,
                        TextTrimming: TextTrimming.Ellipsis
                    },
                }
            )

            if failure != "" {
                preview.Children.Add(Ui.ErrorText("Rename failed: " + failure, p))
            }
        }
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

                bulkSummary = (results.Count - failed).ToString() + " renamed, " + failed.ToString() + " failed."
            },
            names: names
        )
    }
}
