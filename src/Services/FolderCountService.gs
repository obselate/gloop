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
    private let window Window
    private let changed Action
    private let gate object = Object()
    private let counts Dictionary[string, int32] = Dictionary[string, int32](StringComparer.Ordinal)
    private let pending List[FolderCountRequest] = List[FolderCountRequest]()
    private let queued HashSet[string] = HashSet[string](StringComparer.Ordinal)
    private var workers int32
    private var posted bool
    private var lastPost int64
    private var closed bool

    internal init(window Window, changed Action) {
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
                if pending.Count >= 64 {
                    queued.Remove(pending[0].Key)
                    pending.RemoveAt(0)
                }
                pending.Add(FolderCountRequest{Key: key, Path: entry.FullPath, ShowHidden: showHidden})
                if workers < 2 {
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
                if (count & 1023) == 0 && isClosed() {
                    return
                }
            }
        } catch (failure Exception) {
            count = -2
        }
        var notify bool
        lock gate {
            if closed {
                return
            }
            if counts.Count >= 4096 {
                counts.Clear()
            }
            counts[request.Key] = count
            queued.Remove(request.Key)
            let now = Environment.TickCount64
            if !posted && (pending.Count == 0 || now - lastPost >= 100) {
                posted = true
                lastPost = now
                notify = true
            }
        }
        if notify {
            try {
                window.Post(() -> flush())
            } catch (failure Exception) { }
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
        lock gate {
            posted = false
            if closed {
                return
            }
        }
        changed()
    }

    private func isClosed() bool {
        lock gate {
            return closed
        }
    }
}

func folderCountWorker(service FolderCountService) {
    while let request = service.Take() {
        service.Process(request)
    }
}
