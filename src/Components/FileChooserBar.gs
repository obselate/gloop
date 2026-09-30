package gloop

import Goo
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System
import System.Collections.Generic

internal data struct FileChooserBarInput {
    var Request PortalChooserRequest
    var Name string
    var OnNameChange Action[string]
    var NameHandle ElementHandle
    var FilterIndex int32
    var OnFilterChange Action[int32]
    var Choices IReadOnlyDictionary[string, string]
    var OnChoiceChange Action[string, string]
    var Summary string
    var Error string
    var OnAccept Action
    var OnCancel Action
    var OverlayHost ElementHandle
    var Host Window
    var Palette Palette
}

open class FileChooserBar : Cell[FileChooserBarInput] {
    private let acceptHandle ElementHandle = ElementHandle()
    private let cancelHandle ElementHandle = ElementHandle()

    protected override func Build(value FileChooserBarInput) Blob {
        let p = value.Palette
        let request = value.Request
        let root = Container{
            Padding: Edges{Left: 12, Right: 12, Top: 8, Bottom: 8},
            Gap: 8,
            FlexShrink: 0,
            BorderWidth: Edges{Top: 1},
            BorderColor: p.Border,
            BackgroundColor: p.Background,
        }
        let fields = Container{FlexDirection: FlexDirection.Row, AlignItems: AlignItems.Center, Gap: 8, MinWidth: 0}
        if request.Method == "SaveFile" {
            fields.Children.Add(Ui.Label("File name", p.Muted, 12))
            fields.Children.Add(
                TextEntry{
                    Handle: value.NameHandle,
                    Value: value.Name,
                    Controlled: true,
                    AutoFocus: true,
                    FlexGrow: 1,
                    FlexBasis: 0,
                    MinWidth: 120,
                    Height: 32,
                    Padding: Edges{Left: 8, Right: 8},
                    BackgroundColor: p.Surface,
                    Color: p.Text,
                    BorderWidth: 1,
                    BorderColor: p.Border,
                    BorderRadius: 4,
                    Focus: Style{BorderColor: p.Accent},
                    FontSize: 13,
                    Accessibility: Accessibility{Role: AccessibilityRole.TextInput, Name: "File name"},
                    OnChange: value.OnNameChange,
                    OnSubmit: (_) -> value.OnAccept(),
                }
            )
        }
        if request.Filters.Count > 0 {
            let options = [request.Filters.Count]ComboBoxOption
            for index in 0 ... options.Length {
                let filter = request.Filters[index]
                options[index] = ComboBoxOption{
                    Id: index.ToString(),
                    Label: filter.Name,
                    Content: Ui.Label(filter.Name, p.Text, 12),
                }
            }
            fields.Children.Add(
                Select(
                    "file-type",
                    "File type",
                    options,
                    value.FilterIndex.ToString(),
                    id -> value.OnFilterChange(Int32.Parse(id)),
                    value
                )
            )
        }
        if fields.Children.Count > 0 {
            root.Children.Add(fields)
        }
        if request.Choices.Count > 0 {
            let choices = Container{
                FlexDirection: FlexDirection.Row,
                FlexWrap: FlexWrap.Wrap,
                AlignItems: AlignItems.Center,
                Gap: 12,
                MaxHeight: 150,
                OverflowY: Overflow.Scroll,
                ScrollbarY: Ui.ScrollbarStyle(p),
            }
            for choice in request.Choices {
                let id = choice.Id
                let selected = value.Choices[id]
                if choice.Options.Count == 0 {
                    let toggle = Checkbox{
                        Label: choice.Label,
                        State: selected == "true" ? AccessibilityChecked.True: AccessibilityChecked.False,
                        OnChange: state -> value.OnChoiceChange(
                            id,
                            state == AccessibilityChecked.True ? "true": "false"
                        ),
                        LabelColor: p.Text,
                        LabelFontSize: 12,
                        Size: 16,
                        BackgroundColor: p.Surface,
                        BorderColor: p.Border,
                        CheckedBackgroundColor: p.Accent,
                        CheckedBorderColor: p.Accent,
                        MarkColor: p.Background,
                    }.Build()
                    toggle.Width = 320
                    toggle.MinWidth = 0
                    toggle.MaxWidth = 320
                    if toggle is Button {
                        for child in toggle.Children {
                            if child is Text {
                                child.FlexGrow = 1
                                child.FlexBasis = 0
                                child.MinWidth = 0
                                child.MaxWidth = 296
                                child.TextWrap = TextWrap.NoWrap
                                child.TextTrimming = TextTrimming.Ellipsis
                            } else {
                                child.FlexShrink = 0
                            }
                        }
                    }
                    choices.Children.Add(Tip("boolean-" + id, choice.Label, toggle, 320, value))
                } else {
                    let options = [choice.Options.Count]ComboBoxOption
                    for index in 0 ... options.Length {
                        let option = choice.Options[index]
                        options[index] = ComboBoxOption{
                            Id: option.Id,
                            Label: option.Label,
                            Content: Ui.Label(option.Label, p.Text, 12)
                        }
                    }
                    choices.Children.Add(
                        Container{
                            Width: 328,
                            MinWidth: 0,
                            FlexShrink: 0,
                            FlexDirection: FlexDirection.Row,
                            AlignItems: AlignItems.Center,
                            Gap: 8,
                            Tip(
                                "choice-label-" + id,
                                choice.Label,
                                Text{
                                    Content: choice.Label,
                                    Width: 110,
                                    MaxWidth: 110,
                                    MinWidth: 0,
                                    Color: p.Muted,
                                    FontSize: 12,
                                    TextWrap: TextWrap.NoWrap,
                                    TextTrimming: TextTrimming.Ellipsis,
                                },
                                110,
                                value
                            ),
                            Select(
                                "choice-" + id,
                                choice.Label,
                                options,
                                selected,
                                option -> value.OnChoiceChange(id, option),
                                value
                            ),
                        }
                    )
                }
            }
            root.Children.Add(choices)
        }
        if value.Error != "" {
            root.Children.Add(Text{Content: value.Error, Color: p.Error, FontSize: 12, TextWrap: TextWrap.Wrap})
        }
        root.Children.Add(
            Container{
                FlexDirection: FlexDirection.Row,
                AlignItems: AlignItems.Center,
                Gap: 8,
                Container{FlexGrow: 1, FlexBasis: 0, MinWidth: 0, Ui.Label(value.Summary, p.Muted, 12)},
                ActionButton("Cancel", value.OnCancel, value),
                ActionButton(
                    request.AcceptLabel != "" ? request.AcceptLabel: request.Method != "OpenFile" ? "Save": request.Directory ? "Select folder": "Open",
                    value.OnAccept,
                    value,
                    true
                ),
            }
        )
        return root
    }

    private func Select(
        key string,
        label string,
        options[]ComboBoxOption,
        selected string,
        onSelect Action[string],
        value FileChooserBarInput
    ) Blob {
        let p = value.Palette
        let selector = Cell.Mount[ComboBoxInput, ComboBox](
            key,
            ComboBoxInput{
                Items: options,
                SelectedId: selected,
                OnSelect: onSelect,
                AccessibilityName: label,
                OverlayHost: value.OverlayHost,
                Width: 210,
                RowHeight: 30,
                CreateTrigger: (_, row) -> {
                    row.Height = 32
                    row.Padding = Edges{Left: 8, Right: 8}
                    row.BackgroundColor = p.Surface
                    row.BorderColor = p.Border
                    row.BorderRadius = 4
                    row.Focus = Style{BorderColor: p.Accent}
                    return row
                },
                CreatePopup: (_, panel) -> {
                    panel.BackgroundColor = p.Surface
                    panel.BorderColor = p.Border
                    return panel
                },
                CreateRow: (input, item, row) -> {
                    row.BackgroundColor = input.SelectedId == item.Id ? p.Selection: Color.Transparent
                    row.OutlineColor = p.Accent
                    row.Hover = Style{BackgroundColor: p.Selection}
                    return row
                },
            }
        )
        var description = label
        for option in options {
            if option.Id == selected {
                description = option.Label ?? label
                break
            }
        }
        return Tip(key + "-label", description, selector, 210, value)
    }

    private func ActionButton(label string, action Action, value FileChooserBarInput, primary bool = false) Blob {
        let p = value.Palette
        let button = Ui.ActionButton(label, action, p, primary, primary ? acceptHandle: cancelHandle)
        button.MaxWidth = 200
        button.MinWidth = 0
        if button is Button {
            for child in button.Children {
                if child is Text {
                    child.Width = Percent(100)
                    child.MaxWidth = 172
                    child.MinWidth = 0
                    child.TextWrap = TextWrap.NoWrap
                    child.TextTrimming = TextTrimming.Ellipsis
                }
            }
        }
        return Tip("action-" + label, label, button, 200, value)
    }

    private func Tip(key string, label string, target Blob, maxWidth float64, value FileChooserBarInput) Blob {
        let p = value.Palette
        return Container{
            MaxWidth: maxWidth,
            MinWidth: 0,
            FlexShrink: 0,
            Cell.Mount[TooltipInput, Tooltip](
                key,
                TooltipInput{
                    Window: value.Host,
                    Content: Text{Content: label, Color: p.Text, FontSize: 12, MaxWidth: 320, TextWrap: TextWrap.Wrap},
                    BubbleStyle: Style{
                        BackgroundColor: p.Surface,
                        Padding: 8,
                        BorderWidth: 1,
                        BorderColor: p.Border,
                        BorderRadius: 4
                    },
                    Target: Container{MinWidth: 0, MaxWidth: maxWidth, OverflowX: Overflow.Hidden, target},
                }
            ),
        }
    }
}
