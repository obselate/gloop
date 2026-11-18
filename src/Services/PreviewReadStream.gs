package gloop

import System
import System.IO

class PreviewLimitException : IOException { }

class PreviewReadStream : Stream {
    private let source Stream
    private let cancelled Func[bool]
    private let seekable bool
    private var remaining int64
    private var seeks int32 = 0
    private var ended bool = false
    private var exceeded bool = false

    internal init(source Stream, limit int64, cancelled Func[bool], seekable bool = false) {
        this.source = source
        this.remaining = limit
        this.seekable = seekable && source.CanSeek
        this.cancelled = cancelled
    }

    override prop CanRead bool {
        get -> true
    }
    override prop CanSeek bool {
        get -> seekable
    }
    override prop CanWrite bool {
        get -> false
    }
    override prop Length int64 {
        get {
            if !seekable {
                throw NotSupportedException()
            }
            return source.Length
        }
    }
    override prop Position int64 {
        get {
            if !seekable {
                throw NotSupportedException()
            }
            return source.Position
        }
        set {
            Seek(value, SeekOrigin.Begin)
        }
    }

    override func Read(buffer[]uint8, offset int32, count int32) int32 {
        if cancelled() {
            throw OperationCanceledException()
        }
        if count == 0 {
            return 0
        }
        if exceeded {
            throw PreviewLimitException()
        }
        if ended {
            return 0
        }
        if remaining == 0 {
            if source.ReadByte() < 0 {
                ended = true
                return 0
            }
            exceeded = true
            throw PreviewLimitException()
        }
        let read = source.Read(buffer, offset, int32(Math.Min(int64(count), remaining)))
        remaining -= read
        return read
    }

    override func Seek(offset int64, origin SeekOrigin) int64 {
        if !seekable {
            throw NotSupportedException()
        }
        if cancelled() {
            throw OperationCanceledException()
        }
        seeks++
        if seeks > 4096 {
            throw PreviewLimitException()
        }
        ended = false
        return source.Seek(offset, origin)
    }

    override func Flush() {
        throw NotSupportedException()
    }

    override func SetLength(value int64) {
        throw NotSupportedException()
    }

    override func Write(buffer[]uint8, offset int32, count int32) {
        throw NotSupportedException()
    }
}
