package gloop

import Goo
import System
import System.IO

data struct SettingsWriteRequest {
    internal var Snapshot AppSettings
    internal var Version int64
}

internal class SettingsWriter {
    private let window Window
    private let service SettingsService
    private let onError Action[string]
    private let gate object = Object()
    private var pending SettingsWriteRequest?
    private var completion chan[bool]?
    private var version int64
    private var running bool
    private var disposed bool

    internal init(window Window, service SettingsService, onError Action[string]) {
        this.window = window
        this.service = service
        this.onError = onError
    }

    internal func Save(settings AppSettings) string {
        let error = SettingsService.Validate(settings)
        if error != "" {
            return error
        }
        let snapshot = settings.Clone()
        var started chan[bool]?
        lock gate {
            if disposed {
                return "Settings writer is closed"
            }
            version++
            pending = SettingsWriteRequest{Snapshot: snapshot, Version: version}
            if !running {
                running = true
                started = chan[bool](1)
                completion = started
            }
        }
        if let done = started {
            go WriteLoop(done)
        }
        return ""
    }

    internal func ToggleBookmark(settings AppSettings, path string) string {
        let normalized = BookmarkPath.Normalize(path)
        if normalized == "" {
            return "Bookmark must be an absolute folder path"
        }
        let draft = settings.Clone()
        if !draft.Bookmarks.Remove(normalized) {
            if !Directory.Exists(normalized) {
                return "Folder does not exist: " + normalized
            }
            draft.Bookmarks.Add(normalized)
        }
        let error = Save(draft)
        if error != "" {
            return error
        }
        settings.ApplyFrom(draft)
        return ""
    }

    internal func Dispose() {
        var done chan[bool]?
        lock gate {
            disposed = true
            done = completion
        }
        if let finished = done {
            <-finished
        }
    }

    private func WriteLoop(done chan[bool]) {
        while true {
            var request SettingsWriteRequest?
            lock gate {
                request = pending
                pending = nil
                if request == nil {
                    running = false
                    completion = nil
                }
            }
            guard let current = request else {
                done.Close()
                return
            }
            var error string
            try {
                error = service.Save(current.Snapshot)
            } catch (failure Exception) {
                error = "Could not save settings: " + failure.Message
            }
            if error != "" {
                try {
                    window.Post(() -> ReportError(current.Version, error))
                } catch (failure Exception) { }
            }
        }
    }

    private func ReportError(failedVersion int64, error string) {
        lock gate {
            if failedVersion != version {
                return
            }
        }
        onError(error)
    }
}
