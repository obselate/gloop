package gloop

import Goo
import System
import System.Collections.Generic

internal data struct TextPreviewInput {
    var Preview PreviewData
    var Palette Palette
    var WordWrap bool
    var LineNumbers bool
}

open class TextPreview : Cell[TextPreviewInput], IDisposable {
    private var controller TextEditorController?
    private var layer TextPresentationLayer?
    private var text string = ""
    private var path string = ""
    private var palette Palette?

    /// Releases the preview document's presentation and selection state.
    public func Dispose() {
        layer?.Dispose()
        controller?.Dispose()
        layer = nil
        controller = nil
        palette = nil
    }

    protected override func Build(value TextPreviewInput) Blob {
        let preview = value.Preview
        let p = value.Palette
        if controller == nil || path != preview.Path || !Object.ReferenceEquals(text, preview.Text) {
            Dispose()
            text = preview.Text
            path = preview.Path
            let document = TextDocument(text)
            controller = TextEditorController(document)
            layer = TextPresentationLayer(document)
        }
        guard let editorController = controller, let syntax = layer else {
            throw InvalidOperationException("Preview document was not initialized")
        }
        if palette?.Muted != p.Muted || palette?.Keyword != p.Keyword || palette?.String != p.String
        || palette?.Number != p.Number || palette?.Type != p.Type {
            let colors = Dictionary[string, Style]()
            colors["comment"] = Style{Color: p.Muted}
            colors["keyword"] = Style{Color: p.Keyword}
            colors["string"] = Style{Color: p.String}
            colors["number"] = Style{Color: p.Number}
            colors["type"] = Style{Color: p.Type}
            let spans = [preview.Styles.Length]TextStyleSpan
            for index in 0 ... spans.Length {
                let span = preview.Styles[index]
                spans[index] = TextStyleSpan(index.ToString(), TextRange(span.Start, span.Length), colors[span.Kind])
            }
            syntax.ReplaceStyles(spans)
        }
        palette = p
        let children = List[Blob]()
        children.Add(
            Container{
                Key: "preview-canvas",
                FlexGrow: 1,
                FlexBasis: 0,
                MinWidth: 0,
                MinHeight: 0,
                TextEditor(editorController, []TextPresentationLayer{syntax}){
                    Key = "preview-document",
                    ReadOnly = true,
                    Position = PositionType.Absolute,
                    Left = 8,
                    Right = 8,
                    Top = 8,
                    Bottom = 8,
                    FontFamily = "monospace, Noto Sans CJK",
                    FontSize = 13,
                    LineHeight = 1.5,
                    TextWrap = value.WordWrap ? TextWrap.Wrap: TextWrap.NoWrap,
                    ShowLineNumbers = value.LineNumbers,
                    LineNumberColor = p.Muted,
                    Color = p.Text,
                    SelectionColor = p.Selection,
                    CaretColor = p.Accent,
                    OverscanLines = 3,
                    OverflowX = Overflow.Scroll,
                    OverflowY = Overflow.Scroll,
                    ScrollbarX = Ui.ScrollbarStyle(p),
                    ScrollbarY = Ui.ScrollbarStyle(p),
                    ScrollbarVisibilityX = ScrollbarVisibility.Always,
                    ScrollbarVisibilityY = ScrollbarVisibility.Always,
                    Accessibility = Accessibility{Role: AccessibilityRole.TextInput, Name: "Text preview"},
                    Focus = Style{OutlineWidth: 1, OutlineColor: p.Accent, OutlineOffset: 2},
                },
            }
        )
        if preview.Warning != "" {
            children.Add(
                Container{
                    Key: "preview-warning",
                    FlexShrink: 0,
                    Padding: Edges{Left: 10, Right: 10, Top: 6, Bottom: 6},
                    BorderWidth: Edges{Top: 1},
                    BorderColor: p.Border,
                    Text{Content: preview.Warning, Color: p.Muted, FontSize: 11, TextWrap: TextWrap.Wrap},
                }
            )
        }
        return Container{
            FlexGrow: 1,
            FlexBasis: 0,
            MinWidth: 0,
            MinHeight: 0,
            BackgroundColor: p.Background,
            Children: children.ToArray(),
        }
    }
}
