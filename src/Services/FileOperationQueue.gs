package gloop

import Goo
import System
import System.Collections.Generic
import System.IO

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

    internal func CanUseArchive(action string) bool {
        let pane = controller.ActivePane()

        if pane.Kind == LocationKind.Archive &&
            (
            action == "Rename" ||
                action == "Trash" ||
                action == "Cut" ||
                action == "Copy" ||
                action == "Paste" ||
                action == "NewFolder" ||
                action == "Compress" ||
                action == "Properties" ||
                action == "OpenTerminal" ||
                action == "OpenTerminalHere" ||
                action == "ToggleBookmark"
        ) {
            return false
        }

        if action == "Extract" || action == "Compress" {
            if pane.Kind == LocationKind.Trash || pane.Kind == LocationKind.Recent || pane.SelectedPaths.Count == 0 {
                return false
            }

            if action == "Extract" && pane.Kind != LocationKind.Archive {
                for source in pane.SelectionPaths() {
                    if !ArchiveService.Supported(source) {
                        return false
                    }
                }
            }
        }

        return true
    }

    internal func CanDrag(paneIndex int32) bool -> AcceptingOperations &&
        paneIndex >= 0 &&
        paneIndex < controller.VisiblePaneCount &&
        controller
        .Pane(paneIndex).Kind != LocationKind.Trash && controller.Pane(paneIndex).Kind != LocationKind.Archive

    internal func CanDrop(destination string) bool -> AcceptingOperations && controller.Archives.Source(
        destination
    ) == "" &&
        Locations.Resolve(
        destination,
        controller.TrashDirectory,
        out var fullPath,
        out var atTrashRoot
    ) == LocationKind.Folder

    internal func Drop(sources List[string], destination string, copy bool) {
        if CanDrop(destination) && sources.Count > 0 {
            StartOperation(copy ? OperationKind.Copy: OperationKind.Move, sources, destination, "")
        }
    }

    internal func Extract(destination string) {
        var folder = controller.ActivePane().DirectoryPath

        if controller.ActivePane().Kind == LocationKind.Archive {
            folder = Path.GetDirectoryName(controller.Archives.Source(folder)) ?? folder
        }

        try {
            if destination.StartsWith('~') {
                throw ArgumentException("Use a folder path without '~'")
            }

            StartOperation(
                OperationKind.Extract,
                controller.ActivePane().SelectionPaths(),
                Path.GetFullPath(destination, folder),
                ""
            )
        } catch (failure ArgumentException) {
            controller.Status = "Extract failed for " + destination + ": " + failure.Message
            controller.Notify()
        }
    }

    internal func Compress(name string) {
        StartOperation(
            OperationKind.Compress,
            controller.ActivePane().SelectionPaths(),
            controller.ActivePane().DirectoryPath,
            name
        )
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
        clipboardVersion int32 = -1,
        completed Action[List[OperationResult]]? = nil,
        permission UnixFileMode = UnixFileMode.None,
        enabled bool = false
    ) {
        let sources = List[string]()
        sources.Add(source)

        StartOperation(kind, sources, destination, name, clipboardVersion, completed, permission, enabled)
    }

    internal func StartOperation(
        kind OperationKind,
        sources List[string],
        destination string,
        name string,
        clipboardVersion int32 = -1,
        completed Action[List[OperationResult]]? = nil,
        permission UnixFileMode = UnixFileMode.None,
        enabled bool = false,
        names List[string]? = nil
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
                Completed: completed,
                Permission: permission,
                Enabled: enabled,
                Names: names ?? sources,
            }
        )

        if admission == OperationAdmission.Full || admission == OperationAdmission.Closed {
            let error = "File operation queue is " + (admission == OperationAdmission.Full ? "full": "closed")

            if kind == OperationKind.Permissions {
                let results = List[OperationResult](1)
                results.Add(OperationResult{Source: sources[0], FinalPath: sources[0], Error: error})
                completed?(results)
            } else {
                controller.Status = kind.ToString() + ": " + error
            }

            controller.Notify()

            return
        }

        if TracksSources(kind) {
            for source in sources {
                movingSources.Add(source)
            }
        }

        operationCount++
        if kind != OperationKind.Permissions {
            controller.Status = "Working…"
        }

        controller.Notify()

        if admission == OperationAdmission.StartWorker {
            let queue = this
            let owner = window
            go fileOperationWorker(owner, queue, controller.Archives)
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

            if request.Kind == OperationKind.Rename || request.Kind == OperationKind.BulkRename {
                for pane in controller.Panes {
                    pane.RetargetSelection(result.Source, result.FinalPath)
                }
            }
        }

        if succeeded > 0 {
            controller.Directories.RefreshLoadedPanes(
                request.Kind == OperationKind.Rename || request.Kind == OperationKind.BulkRename
                ? results: default(List[OperationResult]?)
            )
        }

        if failed > 0 && request.Kind != OperationKind.Permissions {
            let operation = switch request.Kind {
                case OperationKind.CreateFolder: "Create folder"
                case OperationKind.BulkRename: "Bulk rename"
                default: request.Kind.ToString()
            }
            controller.Status = results.Count == 1
            ? operation + " failed for " + firstError
            : operation + ": " + succeeded.ToString() + " done, " + failed.ToString() + " failed. " + firstError

            if closeRequested && closeFailure == "" {
                closeFailure = controller.Status
            }
        } else if closeFailure == "" && request.Kind != OperationKind.Permissions {
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

        request.Completed?(results)

        controller.Notify()
    }

    private func TracksSources(kind OperationKind) bool -> kind == OperationKind.Move ||
        kind == OperationKind.Trash ||
        kind == OperationKind.Rename ||
        kind == OperationKind.BulkRename ||
        kind == OperationKind.Restore ||
        kind == OperationKind.Delete
}

func fileOperationWorker(window Window, queue FileOperationQueue, archives ArchiveService) {
    while let request = queue.Take() {
        let results = List[OperationResult](request.Sources.Count)
        let operations = FileOperationService()
        let trash = TrashService()

        for index in 0 ... request.Sources.Count {
            let source = request.Sources[index]
            var result OperationResult

            try {
                result = switch request.Kind {
                    case OperationKind.CreateFolder: operations.CreateFolder(source, request.Name)
                    case OperationKind.Rename: operations.Rename(source, request.Name)
                    case OperationKind.BulkRename: operations.Rename(source, request.Names[index])
                    case OperationKind.Copy: operations.Copy(source, request.Destination)
                    case OperationKind.Move: operations.Move(source, request.Destination)
                    case OperationKind.Trash: trash.Trash(source)
                    case OperationKind.Restore: trash.Restore(source)
                    case OperationKind.Delete: trash.Delete(source)
                    case OperationKind.Empty: trash.Empty()
                    case OperationKind.Permissions: PropertiesService.SetPermission(
                        source,
                        request.Permission,
                        request.Enabled
                    )
                    case OperationKind.Extract: archives.Extract(source, request.Destination)
                    case OperationKind.Compress: archives.Compress(request.Sources, request.Destination, request.Name)
                    default: throw Exception("Unknown file operation kind: " + request.Kind.ToString())
                }
            } catch (failure Exception) {
                result = OperationResult{Source: source, FinalPath: "", Error: failure.Message}
            }

            if request.Kind == OperationKind.Extract || request.Kind == OperationKind.Compress {
                result.Source = source
            }

            results.Add(result)

            if request.Kind == OperationKind.Compress {
                break
            }
        }

        try {
            window.Post(() -> queue.CompleteOperation(request, results))
        } catch (failure InvalidOperationException) { }
    }
}
