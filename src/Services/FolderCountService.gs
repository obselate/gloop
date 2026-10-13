package gloop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.IO.Enumeration

data struct FolderCountRequest {
    internal var Key string
    internal var Path string
    internal var ShowHidden bool
}

class FolderCountService {
    private const QueueLimit int32 = 64
    private const WorkerLimit int32 = 2
    private const CacheLimit int32 = 4096
    private const CancellationCheckMask int32 = 1023
    private const NotifyIntervalMilliseconds int64 = 100

    private let window Window
    private let changed Action[string]
    private let gate object = Object()
    private let counts Dictionary[string, int32] = Dictionary[string, int32](StringComparer.Ordinal)
    private let pending List[FolderCountRequest] = List[FolderCountRequest]()
    private let queued HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var workers int32
    private var posted bool
    private var lastPost int64
    private var error string = ""
    private var closed bool

    internal init(window Window, changed Action[string]) {
        this.window = window
        this.changed = changed
    }

    internal func Count(entry FileEntry, showHidden bool) int32 {
        let key = entry.FullPath + "\0" + entry.Modified.Ticks.ToString() + (showHidden ? "\0h": "")
        var started bool

        lock gate {
            if closed {
                return -1
            }
            if counts.TryGetValue(key, out var count) {
                return count
            }

            if queued.Add(key) {
                if pending.Count >= QueueLimit {
                    queued.Remove(pending[0].Key)
                    pending.RemoveAt(0)
                }

                pending.Add(FolderCountRequest{Key: key, Path: entry.FullPath, ShowHidden: showHidden})

                if workers < WorkerLimit {
                    workers++
                    started = true
                }
            }
        }

        if started {
            go folderCountWorker(this)
        }

        return -1
    }

    internal func Take() FolderCountRequest? {
        lock gate {
            if closed || pending.Count == 0 {
                workers--

                return nil
            }

            let request = pending[pending.Count - 1]
            pending.RemoveAt(pending.Count - 1)

            return request
        }
    }

    internal func Process(request FolderCountRequest) {
        var count int32
        var error = ""

        try {
            let options = EnumerationOptions()
            options.AttributesToSkip = FileAttributes(0)
            options.IgnoreInaccessible = false
            let enumeration = FileSystemEnumerable[bool](request.Path, (ref raw FileSystemEntry) -> true, options)

            if !request.ShowHidden {
                enumeration.ShouldIncludePredicate = (ref raw FileSystemEntry) ->
                raw.FileName.Length == 0 || raw.FileName[0] != '.'
            }

            for item in enumeration {
                count++

                if (count & CancellationCheckMask) == 0 && isClosed() {
                    return
                }
            }
        } catch (failure Exception) when failure is IOException || failure is UnauthorizedAccessException {
            count = -2
            error = "Count folder failed for " + request.Path + ": " + failure.Message
        }

        var notify bool

        lock gate {
            if closed {
                return
            }

            if counts.Count >= CacheLimit {
                counts.Clear()
            }

            counts[request.Key] = count
            queued.Remove(request.Key)

            if error != "" {
                this.error = error
            }

            let now = Environment.TickCount64

            if !posted && (pending.Count == 0 || now - lastPost >= NotifyIntervalMilliseconds) {
                posted = true
                lastPost = now
                notify = true
            }
        }

        if notify {
            try {
                window.Post(() -> flush())
            } catch (failure InvalidOperationException) { }
        }
    }

    internal func Dispose() {
        lock gate {
            closed = true
            pending.Clear()
            queued.Clear()
            counts.Clear()
        }
    }

    private func flush() {
        var error string

        lock gate {
            posted = false
            error = this.error
            this.error = ""

            if closed {
                return
            }
        }

        changed(error)
    }

    private func isClosed() bool {
        lock gate {
            return closed
        }
    }

    internal func ReportFailure(request FolderCountRequest, failure Exception) {
        lock gate {
            queued.Remove(request.Key)
            counts[request.Key] = -2
            error = "Count folder failed for " + request.Path + ": " + failure.Message
        }

        try {
            window.Post(() -> flush())
        } catch (closed InvalidOperationException) { }
    }
}

func folderCountWorker(service FolderCountService) {
    while let request = service.Take() {
        try {
            service.Process(request)
        } catch (failure Exception) {
            service.ReportFailure(request, failure)
        }
    }
}
