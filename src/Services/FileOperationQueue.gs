package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

class FileOperationQueue {
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
                controller.Status = "File operation already in progress"
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
            controller.Status = admission == OperationAdmission.Full ? "File operation queue is full": "File operation queue is closed"
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

    internal func CompleteOperation(request OperationRequest, succeeded List[string], errors List[string]) {
        if controller.IsDisposed {
            return
        }
        if TracksSources(request.Kind) {
            for source in request.Sources {
                movingSources.Remove(source)
            }
        }
        operationCount--
        controller.CompleteClipboardMove(request, succeeded)
        if succeeded.Count > 0 {
            if request.Kind == OperationKind.Rename {
                let source = succeeded[0]
                let destination = Path.Combine(Path.GetDirectoryName(source) ?? "", request.Name)
                controller.First.RetargetSelection(source, destination)
                controller.Second.RetargetSelection(source, destination)
                controller.Directories.RefreshLoadedPanes(source, destination)
            } else {
                controller.Directories.RefreshLoadedPanes()
            }
        }
        if errors.Count > 0 {
            controller.Status = succeeded.Count.ToString() + " done, " + errors.Count.ToString()
            + " failed: " + errors[0]
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
        let succeeded = List[string]()
        let errors = List[string]()
        let operations = FileOperationService()
        let trash = TrashService()
        for source in request.Sources {
            var error string
            try {
                error = switch request.Kind {
                    case OperationKind.CreateFolder: operations.CreateFolder(source, request.Name)
                    case OperationKind.Rename: operations.Rename(source, request.Name)
                    case OperationKind.Copy: operations.Copy(source, request.Destination)
                    case OperationKind.Move: operations.Move(source, request.Destination)
                    case OperationKind.Trash: operations.Trash(source)
                    case OperationKind.Restore: trash.Restore(source)
                    case OperationKind.Delete: trash.Delete(source)
                    case OperationKind.Empty: trash.Empty()
                    default: throw Exception("Unknown file operation kind: " + request.Kind.ToString())
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
            window.Post(() -> queue.CompleteOperation(request, succeeded, errors))
        } catch (failure Exception) { }
    }
}
