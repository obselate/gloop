package gloop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.IO.Enumeration
import System.Threading

class DirectoryWorkQueue {
    private let gate object = Object()
    private var pending DirectoryRequest?
    private var running bool
    private var closed bool

    internal func Submit(request DirectoryRequest) bool {
        lock gate {
            if closed {
                return false
            }
            pending = request
            if running {
                return false
            }
            running = true
            return true
        }
    }

    internal func Take() DirectoryRequest? {
        lock gate {
            if closed || pending == nil {
                running = false
                return nil
            }
            let request = pending
            pending = nil
            return request
        }
    }

    internal func Close() {
        lock gate {
            closed = true
            pending = nil
        }
    }
}

class ViewWorkQueue {
    private let gate object = Object()
    private var pending ViewRequest?
    private var running bool
    private var closed bool

    internal func Submit(request ViewRequest) bool {
        lock gate {
            if closed {
                return false
            }
            pending = request
            if running {
                return false
            }
            running = true
            return true
        }
    }

    internal func Take() ViewRequest? {
        lock gate {
            if closed || pending == nil {
                running = false
                return nil
            }
            let request = pending
            pending = nil
            return request
        }
    }

    internal func Clear() {
        lock gate {
            pending = nil
        }
    }

    internal func Close() {
        lock gate {
            closed = true
            pending = nil
        }
    }
}

enum OperationAdmission {
    Closed;
    Full;
    Queued;
    StartWorker
}

class OperationWorkQueue {
    private let gate object = Object()
    private let pending List[OperationRequest] = List[OperationRequest]()
    private var running bool
    private var closed bool

    internal func Submit(request OperationRequest) OperationAdmission {
        lock gate {
            if closed {
                return OperationAdmission.Closed
            }
            if pending.Count >= 16 {
                return OperationAdmission.Full
            }
            pending.Add(request)
            if running {
                return OperationAdmission.Queued
            }
            running = true
            return OperationAdmission.StartWorker
        }
    }

    internal func Take() OperationRequest? {
        lock gate {
            if closed || pending.Count == 0 {
                running = false
                return nil
            }
            let request = pending[0]
            pending.RemoveAt(0)
            return request
        }
    }

    internal func Close() {
        lock gate {
            closed = true
            pending.Clear()
        }
    }
}

class PreviewWorkQueue {
    private let gate object = Object()
    private var pending PreviewRequest?
    private var imageCancellation CancellationTokenSource?
    private var latestGeneration int32 = -1
    private var running bool
    private var closed bool

    internal func Submit(path string, generation int32) bool {
        lock gate {
            if closed {
                return false
            }
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
            latestGeneration = generation
            pending = PreviewRequest{Path: path, Generation: generation}
            if running {
                return false
            }
            running = true
            return true
        }
    }

    internal func Take() PreviewRequest? {
        lock gate {
            if closed || pending == nil {
                running = false
                return nil
            }
            let request = pending
            pending = nil
            return request
        }
    }

    internal func Close() {
        lock gate {
            closed = true
            pending = nil
            latestGeneration = -1
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
        }
    }

    internal func Clear() {
        lock gate {
            pending = nil
            latestGeneration = -1
            if let active = imageCancellation {
                active.Cancel()
                imageCancellation = nil
            }
        }
    }

    internal func IsCurrent(generation int32) bool {
        lock gate {
            return !closed && latestGeneration == generation
        }
    }

    internal func BeginImage(generation int32, cancellation CancellationTokenSource) bool {
        lock gate {
            if closed || latestGeneration != generation {
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
}

func browserLoadWorker(window Window, controller BrowserController, queue DirectoryWorkQueue) {
    while let request = queue.Take() {
        var snapshot DirectorySnapshot
        try {
            snapshot = FileSystemService().List(request.Path, request.ShowHidden)
        } catch (failure Exception) {
            snapshot = DirectorySnapshot{DirectoryPath: request.Path, Error: failure.Message}
        }
        try {
            window.Post(
                () -> controller.ApplyDirectory(
                    request.Index,
                    request.Generation,
                    snapshot,
                    request.Mode,
                    request.HistoryIndex,
                    request.SelectedPath
                )
            )
        } catch (failure Exception) { }
    }
}

func browserViewWorker(window Window, controller BrowserController, queue ViewWorkQueue) {
    while let request = queue.Take() {
        var visible = List[FileEntry]()
        var error = ""
        try {
            if request.Filter == "" && request.EntryFilter == nil {
                visible = FileSystemService().Sort(request.Entries, request.Column, request.Descending)
            } else {
                let wildcard = request.Filter.Contains('*') || request.Filter.Contains('?')
                for entry in request.Entries {
                    if let entryFilter = request.EntryFilter {
                        if !entryFilter(entry) {
                            continue
                        }
                    }
                    let matches = if wildcard {
                        FileSystemName.MatchesSimpleExpression(request.Filter.AsSpan(), entry.Name.AsSpan(), true)
                    } else {
                        entry.Name.Contains(request.Filter, StringComparison.OrdinalIgnoreCase)
                    }
                    if matches {
                        visible.Add(entry)
                    }
                }
                visible = FileSystemService().Sort(visible, request.Column, request.Descending)
            }
        } catch (failure Exception) {
            error = failure.Message
        }
        try {
            window.Post(
                () -> controller.ApplyView(request.Index, request.Generation, visible, request.SelectedPath, error)
            )
        } catch (failure Exception) { }
    }
}

func browserOpen(window Window, controller BrowserController, path string) {
    var error string
    try {
        error = FileSystemService().Open(path)
    } catch (failure Exception) {
        error = failure.Message
    }
    try {
        window.Post(() -> controller.CompleteOpen(error))
    } catch (failure Exception) { }
}

func browserOperationWorker(window Window, controller BrowserController, queue OperationWorkQueue) {
    while let request = queue.Take() {
        let succeeded = List[string]()
        let errors = List[string]()
        let operations = FileOperationService()
        for source in request.Sources {
            var error string
            try {
                if request.Kind == "mkdir" {
                    error = operations.CreateFolder(source, request.Name)
                } else if request.Kind == "rename" {
                    error = operations.Rename(source, request.Name)
                } else if request.Kind == "copy" {
                    error = operations.Copy(source, request.Destination)
                } else if request.Kind == "move" {
                    error = operations.Move(source, request.Destination)
                } else {
                    error = operations.Trash(source)
                }
            } catch (failure Exception) {
                error = failure.Message
            }
            if error == "" {
                succeeded.Add(source)
            } else {
                errors.Add(source + ": " + error)
            }
        }
        try {
            window.Post(() -> controller.CompleteOperation(request, succeeded, errors))
        } catch (failure Exception) { }
    }
}

func browserOpenTerminal(window Window, controller BrowserController, directory string) {
    let error = TerminalService().Open(directory)
    try {
        window.Post(() -> controller.CompleteTerminal(error))
    } catch (failure Exception) { }
}

func browserPreview(window Window, controller BrowserController, queue PreviewWorkQueue) {
    while let request = queue.Take() {
        if !queue.IsCurrent(request.Generation) {
            continue
        }
        var data PreviewData
        var source ImageSource?
        var cache ImageSourceCache?
        try {
            data = FileSystemService().ReadPreview(request.Path, () -> !queue.IsCurrent(request.Generation))
            if data.Kind == "image" && queue.IsCurrent(request.Generation) {
                let cancellation = CancellationTokenSource()
                if queue.BeginImage(request.Generation, cancellation) {
                    try {
                        let imageCache = ImageSourceCache(67108864, 1)
                        cache = imageCache
                        source = imageCache.LoadAsync(data.Path, cancellation.Token).GetAwaiter().GetResult()
                    } finally {
                        queue.FinishImage(cancellation)
                    }
                } else {
                    cancellation.Dispose()
                }
            }
        } catch (failure Exception) {
            let error = if data.Kind == "image" &&
                (failure is InvalidDataException || failure is NotSupportedException) {
                "This image could not be read. It may be damaged or use an unsupported format."
            } else {
                failure.Message
            }
            data = PreviewData{Kind: "error", Text: "", Path: request.Path, Error: error}
            if let failedCache = cache {
                failedCache.Dispose()
            }
            cache = nil
        }
        if !queue.IsCurrent(request.Generation) {
            if let staleSource = source {
                staleSource.Dispose()
            }
            if let staleCache = cache {
                staleCache.Dispose()
            }
            continue
        }
        try {
            window.Post(() -> controller.ApplyPreview(request.Generation, data, source, cache))
        } catch (failure Exception) {
            if let failedSource = source {
                failedSource.Dispose()
            }
            if let failedCache = cache {
                failedCache.Dispose()
            }
        }
    }
}
