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
    private var previewEntry FileEntry?

    internal init(window Window, controller BrowserController, width int32, height int32) {
        this.window = window
        this.controller = controller
        previewWidth = width
        previewHeight = height
        targetPreviewWidth = width
        targetPreviewHeight = height
        Preview = PreviewData{Kind: PreviewKind.None, Text: "", Path: "", Error: ""}
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

    internal func RequestReload() {
        previewEntry = nil
    }

    internal func QueuePreview() {
        let selected = if controller.PreviewVisible && !controller.IsDisposed {
            controller.ActivePane().SelectedEntry()
        } else {
            nil
        }

        if let entry = selected {
            if let previous = previewEntry {
                if entry.FullPath == previous.FullPath &&
                    entry.Size == previous.Size &&
                    entry.Modified == previous.Modified &&
                    entry.Kind == previous.Kind &&
                    entry.IsDirectory == previous.IsDirectory &&
                    entry.IsSymlink == previous.IsSymlink {
                    return
                }
            }
        }

        previewEntry = selected

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
        Preview = PreviewData{Kind: PreviewKind.None, Text: "", Path: "", Error: ""}

        if let source = PreviewImage {
            source.Dispose()
        }

        PreviewImage = nil

        guard let entry = selected else {
            Clear()
            return
        }

        if entry.IsDirectory && controller.ActivePane().Kind == LocationKind.Archive {
            Clear()
            return
        }

        Preview = PreviewData{Kind: PreviewKind.Loading, Path: entry.FullPath}

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
        Preview.Kind == PreviewKind.Image &&
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

        if data.Kind == PreviewKind.Error && PreviewImage != nil && Preview.Path == request.Path {
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

        if data.Kind != PreviewKind.Error {
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
                    let data = PreviewData{
                        Kind: PreviewKind.Error,
                        Text: "",
                        Path: request.Path,
                        Error: "Preview failed for " + request.Path + ": " + failure.Message
                    }
                    try {
                        window.Post(() -> ApplyPreview(request, data, nil))
                    } catch (postFailure InvalidOperationException) { }
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
            let path = controller.Archives.Preview(request.Path)
            data = FileSystemService().ReadPreview(path, () -> !work.IsCurrent(generation))

            if data.Kind == PreviewKind.Image && work.IsCurrent(generation) {
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
            data.Path = request.Path
        } catch (failure OperationCanceledException) {
            data = PreviewData{Kind: PreviewKind.Cancelled, Path: request.Path}
        } catch (failure Exception) when failure is ImageLimitException ||
            failure is IOException ||
            failure is UnauthorizedAccessException ||
            failure is NotSupportedException {
            data = PreviewData{
                Kind: PreviewKind.Error,
                Path: request.Path,
                Error: "Preview failed for " + request.Path + ": " + failure.Message
            }
        }

        if !work.IsCurrent(generation) {
            if let staleSource = source {
                staleSource.Dispose()
            }

            return
        }

        try {
            window.Post(() -> ApplyPreview(request, data, source))
        } catch (failure InvalidOperationException) {
            if let failedSource = source {
                failedSource.Dispose()
            }
        }
    }
}
