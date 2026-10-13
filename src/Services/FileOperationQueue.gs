package gloop

import Goo
import System
import System.Collections.Generic

class FileOperationQueue {
    private const QueueLimit int32 = 16

    private let window Window
    private let controller BrowserController
    private let gate object = Object()
    private let pending List[OperationRequest] = List[OperationRequest]()
    private let movingSources HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var running bool
    private var closed bool
    private var operationCount int32
    private var closeRequested bool
    private var closeFailure string = ""

    internal init(window Window, controller BrowserController) {
        this.window = window
        this.controller = controller
    }

    internal prop IsOperating bool {
        get -> operationCount > 0
    }

    internal prop ReadyToClose bool {
        get -> closeRequested && !IsOperating && closeFailure == ""
    }

    internal prop AcceptingOperations bool {
        get -> !controller.IsDisposed && !closeRequested
    }

    internal func CloseSafely() bool {
        if !IsOperating {
            return true
        }
        closeRequested = true
        controller.Status = "Finishing file operations before exit"
        controller.Notify()
        return false
    }

    internal func Submit(request OperationRequest) OperationAdmission {
        lock gate {
            if closed {
                return OperationAdmission.Closed
            }
            if pending.Count >= QueueLimit {
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
        closeRequested = false
        lock gate {
            closed = true
            pending.Clear()
        }
    }

    internal func StartOperation(
        kind OperationKind,
        source string,
        destination string,
        name string,
        clipboardVersion int32 = -1
    ) {
        let sources = List[string]()
        sources.Add(source)
        StartOperation(kind, sources, destination, name, clipboardVersion)
    }

    internal func StartOperation(
        kind OperationKind,
        sources List[string],
        destination string,
        name string,
        clipboardVersion int32 = -1
    ) {
        if controller.IsDisposed || closeRequested {
            return
        }
        if sources.Count == 0 {
            return
        }
        if TracksSources(kind) {
            for source in sources {
                if !movingSources.Contains(source) {
                    continue
                }
                controller.Status = kind.ToString() + " failed for " + source + ": File operation already in progress"
                controller.Notify()
                return
            }
        }
        let admission = Submit(
            OperationRequest{
                Kind: kind,
                Sources: sources,
                Destination: destination,
                Name: name,
                ClipboardVersion: clipboardVersion,
            }
        )
        if admission == OperationAdmission.Full || admission == OperationAdmission.Closed {
            controller.Status = kind.ToString() +
                ": File operation queue is " +
                (admission == OperationAdmission.Full ? "full": "closed")
            controller.Notify()
            return
        }
        if TracksSources(kind) {
            for source in sources {
                movingSources.Add(source)
            }
        }
        operationCount++
        controller.Status = "Working…"
        controller.Notify()
        if admission == OperationAdmission.StartWorker {
            let queue = this
            let owner = window
            go fileOperationWorker(owner, queue)
        }
    }

    internal func CompleteOperation(request OperationRequest, results List[OperationResult]) {
        if controller.IsDisposed {
            return
        }
        if TracksSources(request.Kind) {
            for source in request.Sources {
                movingSources.Remove(source)
            }
        }
        operationCount--
        controller.CompleteClipboardMove(request, results)
        var succeeded int32
        var failed int32
        var firstError = ""
        for result in results {
            if result.Error != "" {
                failed++
                if firstError == "" {
                    firstError = (request.Kind == OperationKind.CreateFolder ? request.Name: result.Source) +
                        ": " +
                        result.Error
                }
                continue
            }
            succeeded++
            if succeeded == 1 && request.Kind == OperationKind.Rename {
                for pane in controller.Panes {
                    pane.RetargetSelection(result.Source, result.FinalPath)
                }
                controller.Directories.RefreshLoadedPanes(result.Source, result.FinalPath)
            }
        }
        if succeeded > 0 && request.Kind != OperationKind.Rename {
            controller.Directories.RefreshLoadedPanes()
        }
        if failed > 0 {
            let operation = request.Kind == OperationKind.CreateFolder ? "Create folder": request.Kind.ToString()
            controller.Status = results.Count == 1
            ? operation + " failed for " + firstError
            : operation + ": " + succeeded.ToString() + " done, " + failed.ToString() + " failed. " + firstError
            if closeRequested && closeFailure == "" {
                closeFailure = controller.Status
            }
        } else if closeFailure == "" {
            controller.Status = "Done"
        }
        controller.Places.Refresh()
        if closeRequested && operationCount == 0 {
            if closeFailure != "" {
                closeRequested = false
                controller.Status = closeFailure
                closeFailure = ""
            }
        }
        controller.Notify()
    }

    private func TracksSources(kind OperationKind) bool -> kind == OperationKind.Move ||
        kind == OperationKind.Trash ||
        kind == OperationKind.Rename ||
        kind == OperationKind.Restore ||
        kind == OperationKind.Delete
}

func fileOperationWorker(window Window, queue FileOperationQueue) {
    while let request = queue.Take() {
        let results = List[OperationResult](request.Sources.Count)
        let operations = FileOperationService()
        let trash = TrashService()
        for source in request.Sources {
            var result OperationResult
            try {
                result = switch request.Kind {
                    case OperationKind.CreateFolder: operations.CreateFolder(source, request.Name)
                    case OperationKind.Rename: operations.Rename(source, request.Name)
                    case OperationKind.Copy: operations.Copy(source, request.Destination)
                    case OperationKind.Move: operations.Move(source, request.Destination)
                    case OperationKind.Trash: trash.Trash(source)
                    case OperationKind.Restore: trash.Restore(source)
                    case OperationKind.Delete: trash.Delete(source)
                    case OperationKind.Empty: trash.Empty()
                    default: throw Exception("Unknown file operation kind: " + request.Kind.ToString())
                }
            } catch (failure Exception) {
                result = OperationResult{Source: source, FinalPath: "", Error: failure.Message}
            }
            results.Add(result)
        }
        try {
            window.Post(() -> queue.CompleteOperation(request, results))
        } catch (failure InvalidOperationException) { }
    }
}
