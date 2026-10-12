package gloop

import Goo
import System
import System.IO
import System.Threading

class PreviewLoader {
    internal var Preview PreviewData
    internal var PreviewImage ImageSource?
    private let window Window
    private let controller BrowserController
    private let work LatestWork = LatestWork()
    private let gate object = Object()
    private var imageCancellation CancellationTokenSource?
    private var previewGeneration int32
    private var previewWidth int32
    private var previewHeight int32
    private var targetPreviewWidth int32
    private var targetPreviewHeight int32
    private var loadedPreviewWidth int32
    private var loadedPreviewHeight int32
    private var previewAtOriginalSize bool
    private var previewResizeError string = ""

    internal init(window Window, controller BrowserController, width int32, height int32) {
        this.window = window
        this.controller = controller
        previewWidth = width
        previewHeight = height
        targetPreviewWidth = width
        targetPreviewHeight = height
        Preview = PreviewData{Kind: "", Text: "", Path: "", Error: ""}
    }

    internal prop PreviewVersion int32 {
        get -> previewGeneration
    }

    internal prop PreviewResizeFailed bool {
        get -> previewResizeError != ""
    }

    internal func Close() {
        lock gate {
            work.Close()
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
        }
        previewGeneration++
        if let source = PreviewImage {
            source.Dispose()
        }
        PreviewImage = nil
    }

    private func Clear() {
        lock gate {
            work.Cancel()
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
        }
    }

    internal func QueuePreview() {
        if controller.Status == previewResizeError && previewResizeError != "" {
            controller.Status = ""
        }
        previewResizeError = ""
        previewGeneration++
        previewWidth = targetPreviewWidth
        previewHeight = targetPreviewHeight
        loadedPreviewWidth = 0
        loadedPreviewHeight = 0
        previewAtOriginalSize = false
        Preview = PreviewData{Kind: "", Text: "", Path: "", Error: ""}
        if let source = PreviewImage {
            source.Dispose()
        }
        PreviewImage = nil
        if !controller.PreviewVisible || controller.IsDisposed {
            Clear()
            return
        }
        guard let entry = controller.ActivePane().SelectedEntry() else {
            Clear()
            return
        }
        Preview = PreviewData{Kind: "loading", Path: entry.FullPath}
        Submit(
            PreviewRequest{
                Path: entry.FullPath,
                Generation: previewGeneration,
                Width: previewWidth,
                Height: previewHeight
            }
        )
    }

    internal func NeedsPreviewResize(width int32, height int32) bool -> !controller.IsDisposed &&
        controller.PreviewVisible &&
        PreviewImage != nil &&
        !previewAtOriginalSize &&
        Preview.Kind == "image" &&
        (width > previewWidth || height > previewHeight)

    internal func SetPreviewSize(width int32, height int32) {
        targetPreviewWidth = width
        targetPreviewHeight = height
    }

    internal func RefreshPreviewBounds(width int32, height int32) {
        if !NeedsPreviewResize(width, height) {
            return
        }
        guard let entry = controller.ActivePane().SelectedEntry() else {
            return
        }
        if entry.FullPath != Preview.Path {
            return
        }
        previewGeneration++
        previewWidth = Math.Max(previewWidth, width)
        previewHeight = Math.Max(previewHeight, height)
        Submit(
            PreviewRequest{
                Path: entry.FullPath,
                Generation: previewGeneration,
                Width: previewWidth,
                Height: previewHeight
            }
        )
    }

    internal func ApplyPreview(request PreviewRequest, data PreviewData, source ImageSource?) {
        if controller.IsDisposed || request.Generation != previewGeneration {
            if let stale = source {
                stale.Dispose()
            }
            return
        }
        if data.Kind == "error" && PreviewImage != nil && Preview.Path == request.Path {
            previewWidth = loadedPreviewWidth
            previewHeight = loadedPreviewHeight
            previewResizeError = "Preview resize failed: " + data.Error
            controller.Status = previewResizeError
            controller.Notify()
            return
        }
        if let old = PreviewImage {
            old.Dispose()
        }
        if data.Kind != "error" {
            if controller.Status == previewResizeError && previewResizeError != "" {
                controller.Status = ""
            }
            previewResizeError = ""
        }
        if let image = source {
            loadedPreviewWidth = request.Width
            loadedPreviewHeight = request.Height
            previewAtOriginalSize = image.Width < request.Width && image.Height < request.Height
        } else {
            previewAtOriginalSize = false
        }
        Preview = data
        PreviewImage = source
        controller.Notify()
    }

    private func Submit(request PreviewRequest) {
        lock gate {
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
            work.Submit(
                generation -> Load(request, generation),
                (_, failure) -> {
                    let data = PreviewData{Kind: "error", Text: "", Path: request.Path, Error: failure.Message}
                    try {
                        window.Post(() -> ApplyPreview(request, data, nil))
                    } catch (postFailure Exception) { }
                }
            )
        }
    }

    internal func BeginImage(generation int32, cancellation CancellationTokenSource) bool {
        lock gate {
            if !work.IsCurrent(generation) {
                return false
            }
            imageCancellation = cancellation
            return true
        }
    }

    internal func FinishImage(cancellation CancellationTokenSource) {
        lock gate {
            if Object.ReferenceEquals(imageCancellation, cancellation) {
                imageCancellation = nil
            }
            cancellation.Dispose()
        }
    }

    private func Load(request PreviewRequest, generation int32) {
        if !work.IsCurrent(generation) {
            return
        }
        var data PreviewData
        var source ImageSource?
        try {
            data = FileSystemService().ReadPreview(request.Path, () -> !work.IsCurrent(generation))
            if data.Kind == "image" && work.IsCurrent(generation) {
                let cancellation = CancellationTokenSource()
                if BeginImage(generation, cancellation) {
                    try {
                        source = ImageSource.LoadThumbnail(
                            data.Path,
                            request.Width,
                            request.Height,
                            ThumbnailService.ImageLimits,
                            cancellation.Token
                        )
                    } finally {
                        FinishImage(cancellation)
                    }
                } else {
                    cancellation.Dispose()
                }
            }
        } catch (failure Exception) {
            let error = if data.Kind == "image" && failure is ImageLimitException {
                "This image is too large to preview."
            } else if data.Kind == "image" && (failure is InvalidDataException || failure is NotSupportedException) {
                "This image could not be read. It may be damaged or use an unsupported format."
            } else {
                failure.Message
            }
            data = PreviewData{Kind: "error", Text: "", Path: request.Path, Error: error}
        }
        if !work.IsCurrent(generation) {
            if let staleSource = source {
                staleSource.Dispose()
            }
            return
        }
        try {
            window.Post(() -> ApplyPreview(request, data, source))
        } catch (failure Exception) {
            if let failedSource = source {
                failedSource.Dispose()
            }
        }
    }
}
