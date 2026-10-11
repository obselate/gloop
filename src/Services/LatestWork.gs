package gloop

import System

class LatestWork {
    private let gate object = Object()
    private var generation int32
    private var pending Action?
    private var running bool
    private var closed bool

    internal func Submit(job Action[int32]) {
        var start bool
        lock gate {
            if closed {
                return
            }
            generation++
            let current = generation
            pending = () -> job(current)
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

    internal func Take() Action? {
        lock gate {
            let job = pending
            pending = nil
            if job == nil {
                running = false
            }
            return job
        }
    }
}

func latestWorker(work LatestWork) {
    while let job = work.Take() {
        try {
            job()
        } catch (failure Exception) { }
    }
}
