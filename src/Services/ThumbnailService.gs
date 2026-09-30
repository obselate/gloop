package gloop

import Goo
import System
import System.Collections.Generic
import System.IO
import System.Text
import System.Threading

class ThumbnailLease : IDisposable {
    internal let Owner ThumbnailService
    internal var Item ThumbnailItem?
    internal let Invalidate Action
    internal let Key string
    internal let Entry FileEntry
    internal let Image bool
    internal let Edge int32
    internal var Active bool = true
    internal var Waiting bool

    internal init(
        owner ThumbnailService,
        item ThumbnailItem?,
        invalidate Action,
        key string,
        entry FileEntry,
        image bool,
        edge int32
    ) {
        Owner = owner
        Item = item
        Invalidate = invalidate
        Key = key
        Entry = entry
        Image = image
        Edge = edge
    }

    internal prop Data ThumbnailData {
        get -> Owner.Read(this)
    }

    /// Releases this visible item's demand.
    public func Dispose() {
        Owner.Release(this)
    }
}

class ThumbnailItem {
    internal let Key string
    internal let Entry FileEntry
    internal let Image bool
    internal let Edge int32
    internal let Leases List[ThumbnailLease] = List[ThumbnailLease]()
    internal var Data ThumbnailData = ThumbnailData{Kind: "loading"}
    internal var Cancellation CancellationTokenSource?
    internal var Running bool
    internal var Stamp int64
    internal var Bytes int64

    internal init(key string, entry FileEntry, image bool, edge int32) {
        Key = key
        Entry = entry
        Image = image
        Edge = edge
    }
}

class ThumbnailService : IDisposable {
    private let window Window
    private let gate object = Object()
    private let items Dictionary[string, ThumbnailItem] = Dictionary[string, ThumbnailItem](StringComparer.Ordinal)
    private let pending List[ThumbnailItem] = List[ThumbnailItem]()
    private let waiting List[ThumbnailLease] = List[ThumbnailLease]()
    private var workers int32
    private var stamp int64
    private var bytes int64
    private var closed bool

    internal init(window Window) {
        this.window = window
    }

    internal func Acquire(entry FileEntry, maxEdge int32, invalidate Action) ThumbnailLease {
        let extension = Path.GetExtension(entry.Name).ToLowerInvariant()
        let image = imageExtension(extension)
        let supported = !entry.IsDirectory && !entry.IsSymlink && entry.Size > 0 && (image || textExtension(extension))
        if !supported || maxEdge <= 0 {
            return ThumbnailLease(this, nil, invalidate, "", entry, false, 0)
        }
        let edge = Math.Min(maxEdge, 160)
        let key = entry.FullPath + "\0" + entry.Modified.Ticks.ToString() + "\0" + entry.Size.ToString() +
            "\0" +
            edge.ToString()
        var started bool
        var item ThumbnailItem?
        var lease ThumbnailLease?
        lock gate {
            if !closed {
                if !items.TryGetValue(key, out item) {
                    makeRoom()
                    if waiting.Count == 0 && items.Count < 128 && pending.Count < 64 {
                        item = ThumbnailItem(key, entry, image, edge)
                        items.Add(key, item)
                        pending.Add(item)
                    }
                }
                if let current = item {
                    stamp++
                    current.Stamp = stamp
                    let created = ThumbnailLease(this, current, invalidate, key, entry, image, edge)
                    current.Leases.Add(created)
                    lease = created
                    if workers == 0 && pending.Count > 0 {
                        workers++
                        started = true
                    }
                } else {
                    let created = ThumbnailLease(this, nil, invalidate, key, entry, image, edge)
                    created.Waiting = true
                    waiting.Add(created)
                    lease = created
                }
            }
        }
        if started {
            go thumbnailWorker(this)
        }
        if let current = lease {
            return current
        }
        return ThumbnailLease(this, nil, invalidate, "", entry, false, 0)
    }

    internal func Read(lease ThumbnailLease) ThumbnailData {
        lock gate {
            if !closed && lease.Active {
                if let item = lease.Item {
                    return item.Data
                }
                if lease.Waiting {
                    return ThumbnailData{Kind: "loading"}
                }
            }
        }
        return ThumbnailData{}
    }

    internal func Release(lease ThumbnailLease) {
        var admitted[]ThumbnailLease = []ThumbnailLease{}
        var started bool
        lock gate {
            if !lease.Active {
                return
            }
            lease.Active = false
            if lease.Waiting {
                lease.Waiting = false
                waiting.Remove(lease)
            } else if let item = lease.Item {
                item.Leases.Remove(lease)
                if item.Leases.Count == 0 && item.Data.Kind == "loading" {
                    pending.Remove(item)
                    item.Cancellation?.Cancel()
                    items.Remove(item.Key)
                }
                makeRoom()
                admitted = admitWaiting()
                if workers == 0 && pending.Count > 0 {
                    workers++
                    started = true
                }
            }
        }
        if started {
            go thumbnailWorker(this)
        }
        post(admitted)
    }

    internal func Take() ThumbnailItem? {
        lock gate {
            while pending.Count > 0 && !closed {
                let item = pending[0]
                pending.RemoveAt(0)
                if item.Leases.Count == 0 {
                    continue
                }
                item.Running = true
                item.Cancellation = CancellationTokenSource()
                return item
            }
            workers--
        }
        return nil
    }

    internal func Process(item ThumbnailItem) {
        var result = ThumbnailData{}
        try {
            let info = FileInfo(item.Entry.FullPath)
            if info.Length == item.Entry.Size && info.LastWriteTime == item.Entry.Modified {
                if item.Image {
                    result = loadImage(item)
                } else {
                    result = loadText(item)
                }
                info.Refresh()
                if info.Length != item.Entry.Size || info.LastWriteTime != item.Entry.Modified {
                    if let source = result.Source {
                        source.Dispose()
                    }
                    result = ThumbnailData{}
                }
            }
        } catch (failure Exception) {
            if let source = result.Source {
                source.Dispose()
            }
            result = ThumbnailData{}
        }
        let notify = List[ThumbnailLease]()
        var keep bool
        lock gate {
            item.Cancellation?.Dispose()
            item.Cancellation = nil
            item.Running = false
            var current ThumbnailItem?
            if !closed && item.Leases.Count > 0 && items.TryGetValue(item.Key, out current) && current == item {
                item.Data = result
                item.Bytes = if let source = result.Source {
                    int64(source.Width) * int64(source.Height) * 4
                } else {
                    int64(result.Text.Length) * 2
                }
                bytes += item.Bytes
                notify.AddRange(item.Leases)
                keep = true
                makeRoom()
                notify.AddRange(admitWaiting())
            }
        }
        if !keep {
            if let source = result.Source {
                source.Dispose()
            }
            return
        }
        post(notify)
    }

    private func post(leases IEnumerable[ThumbnailLease]) {
        for lease in leases {
            try {
                window.Post(() -> Notify(lease))
            } catch (failure Exception) { }
        }
    }

    private func admitWaiting()[]ThumbnailLease {
        let admitted = List[ThumbnailLease]()
        var index int32
        var capacityBlocked bool
        while index < waiting.Count {
            let lease = waiting[index]
            var item ThumbnailItem?
            if !items.TryGetValue(lease.Key, out item) {
                if capacityBlocked {
                    index++
                    continue
                }
                makeRoom()
                if items.Count >= 128 || pending.Count >= 64 {
                    capacityBlocked = true
                    index++
                    continue
                }
                item = ThumbnailItem(lease.Key, lease.Entry, lease.Image, lease.Edge)
                items.Add(lease.Key, item)
                pending.Add(item)
            }
            waiting.RemoveAt(index)
            lease.Waiting = false
            lease.Item = item
            if let current = item {
                stamp++
                current.Stamp = stamp
                current.Leases.Add(lease)
                if current.Data.Kind != "loading" {
                    admitted.Add(lease)
                }
            }
        }
        return admitted.ToArray()
    }

    private func Notify(lease ThumbnailLease) {
        lock gate {
            if closed || !lease.Active {
                return
            }
        }
        lease.Invalidate()
    }

    private func makeRoom() {
        while items.Count >= 128 || bytes > 16777216 {
            var oldest ThumbnailItem?
            for candidate in items.Values {
                if candidate
                    .Leases
                    .Count == 0 &&
                    !candidate.Running &&
                    (oldest == nil || candidate.Stamp < oldest.Stamp) {
                    oldest = candidate
                }
            }
            guard let victim = oldest else {
                return
            }
            items.Remove(victim.Key)
            bytes -= victim.Bytes
            if let source = victim.Data.Source {
                source.Dispose()
            }
        }
    }

    private func loadImage(item ThumbnailItem) ThumbnailData {
        guard let cancellation = item.Cancellation else {
            return ThumbnailData{}
        }
        let source = ImageSource.LoadThumbnail(item.Entry.FullPath, item.Edge, item.Edge, cancellation.Token)
        return ThumbnailData{Kind: "image", Source: source}
    }

    private func loadText(item ThumbnailItem) ThumbnailData {
        let limit = int32(Math.Min(item.Entry.Size, int64(4096)))
        let buffer = [limit]uint8
        var count int32
        using let stream = FileStream(item.Entry.FullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)
        while count < limit {
            if item.Cancellation?.IsCancellationRequested == true {
                return ThumbnailData{}
            }
            let read = stream.Read(buffer, count, limit - count)
            if read == 0 {
                break
            }
            count += read
        }
        for index in 0 ... count {
            let value = buffer[index]
            if value == 0 || (value < 32 && value != 9 && value != 10 && value != 13) {
                return ThumbnailData{}
            }
        }
        while count > 0 {
            try {
                let start = if count >= 3 && buffer[0] == 239 && buffer[1] == 187 && buffer[2] == 191 {
                    3
                } else {
                    0
                }
                let text = UTF8Encoding(false, true).GetString(buffer, start, count - start)
                return snippet(text, Path.GetExtension(item.Entry.Name).ToLowerInvariant())
            } catch (failure DecoderFallbackException) {
                if count < limit - 3 {
                    return ThumbnailData{}
                }
                count--
            }
        }
        return ThumbnailData{}
    }

    private func snippet(text string, extension string) ThumbnailData {
        let output = StringBuilder()
        var lines int32 = 0
        var columns int32 = 0
        for character in text {
            if lines >= 6 || output.Length >= 600 {
                break
            }
            if Char.IsControl(character) && character != '\r' && character != '\n' && character != '\t' {
                return ThumbnailData{}
            }
            if character == '\r' {
                continue
            }
            if character == '\n' {
                output.Append('\n')
                lines++
                columns = 0
            } else if columns < 96 {
                output.Append(
                    if character == '\t' {
                        ' '
                    } else {
                        character
                    }
                )
                columns++
            }
        }
        let value = output.ToString().Trim()
        if value == "" {
            return ThumbnailData{}
        }
        return ThumbnailData{Kind: "text", Text: value, Language: PreviewSyntaxService.LanguageFor(extension)}
    }

    private func imageExtension(extension string) bool ->
    extension == ".png" || extension == ".jpg" || extension == ".jpeg" || extension == ".gif"

    private func textExtension(extension string) bool ->
    extension == "" ||
        extension == ".txt" ||
        extension == ".md" ||
        extension == ".log" ||
        extension == ".json" ||
        extension == ".yaml" ||
        extension == ".yml" ||
        extension == ".toml" ||
        extension == ".xml" ||
        extension == ".html" ||
        extension == ".css" ||
        extension == ".js" ||
        extension == ".ts" ||
        extension == ".gs" ||
        extension == ".cs" ||
        extension == ".sh" ||
        extension == ".py" ||
        extension == ".rs" ||
        extension == ".go"

    /// Cancels pending work and releases cached sources.
    public func Dispose() {
        lock gate {
            if closed {
                return
            }
            closed = true
            pending.Clear()
            waiting.Clear()
            for item in items.Values {
                item.Cancellation?.Cancel()
                if let source = item.Data.Source {
                    source.Dispose()
                }
            }
            items.Clear()
            bytes = 0
        }
    }
}

func thumbnailWorker(service ThumbnailService) {
    while let item = service.Take() {
        service.Process(item)
    }
}
