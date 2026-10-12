package gloop

import Goo
import System

partial class BrowserView {
    private var framebufferWidth int32
    private var framebufferHeight int32
    private var previewResizeTimer WindowTimer?
    private var previewVersion int32 = -1
    private var previewSource ImageSource?

    private func PreviewInput() PreviewSidebarInput {
        let entry = Model.SelectedEntry()
        let sizeText = if let selected = entry {
            FileSystemService.FormatSize(selected.Size)
        } else {
            ""
        }
        let preview = Model.Preview
        return PreviewSidebarInput{
            Title: entry?.Name ?? "Preview",
            Preview: preview,
            Image: Model.PreviewImage,
            Entry: entry,
            SizeText: entry?.IsDirectory == true ? "Folder": sizeText,
            Detail: if preview.Error != "" {
                preview.Error
            } else if preview.Text != "Folder" && preview.Text != sizeText {
                preview.Text
            } else {
                ""
            },
            WordWrap: settings.PreviewWordWrap,
            LineNumbers: settings.PreviewLineNumbers,
            Close: () -> Invoke("TogglePreview"),
        }
    }

    private func PreviewWindowMetrics(metrics WindowMetrics) {
        if metrics.FramebufferWidth <= 0 || metrics.FramebufferHeight <= 0 {
            return
        }
        framebufferWidth = metrics.FramebufferWidth
        framebufferHeight = metrics.FramebufferHeight
        Model.SetPreviewSize(framebufferWidth, framebufferHeight)
        SchedulePreviewResize()
    }

    private func PreviewChanged() {
        if Model.PreviewResizeFailed {
            previewResizeTimer?.Dispose()
            previewResizeTimer = nil
            return
        }
        if previewVersion != Model.PreviewVersion || previewSource != Model.PreviewImage {
            previewResizeTimer?.Dispose()
            previewResizeTimer = nil
            previewVersion = Model.PreviewVersion
            previewSource = Model.PreviewImage
            SchedulePreviewResize()
        }
    }

    private func SchedulePreviewResize() {
        if framebufferWidth > 0 && framebufferHeight > 0 && Model.NeedsPreviewResize(
            framebufferWidth,
            framebufferHeight
        ) {
            previewResizeTimer?.Dispose()
            previewResizeTimer = Host.SetTimeout(
                () -> {
                    previewResizeTimer = nil
                    Model.RefreshPreviewBounds(framebufferWidth, framebufferHeight)
                },
                180
            )
        }
    }
}
