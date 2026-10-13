package gloop

import System

class LatestWork {
    private let gate object = Object()
    private var generation int32
    private var pending Action?
    private var pendingFailure Action[Exception]?
    private var running bool
    private var closed bool

    internal func Submit(job Action[int32], failed Action[int32, Exception]) {
        var start bool
        lock gate {
            if closed {
                return
            }
            generation++
            let current = generation
            pending = () -> job(current)
            pendingFailure = failure -> failed(current, failure)
            start = !running
            running = true
        }
        if start {
            go latestWorker(this)
        }
    }

    internal func Cancel() {
        lock gate {
            generation++
            pending = nil
        }
    }

    internal func Close() {
        lock gate {
            closed = true
            generation++
            pending = nil
        }
    }

    internal func IsCurrent(value int32) bool {
        lock gate {
            return !closed && generation == value
        }
    }

    internal func Take(out failed Action[Exception]?) Action? {
        lock gate {
            let job = pending
            pending = nil
            failed = pendingFailure
            pendingFailure = nil
            if job == nil {
                running = false
            }
            return job
        }
    }
}

func latestWorker(work LatestWork) {
    while true {
        var failed Action[Exception]?
        guard let job = work.Take(out failed) else {
            return
        }
        try {
            job()
        } catch (failure Exception) {
            guard let report = failed else {
                throw Exception("Latest work has no failure handler", failure)
            }
            report(failure)
        }
    }
}
