package gloop

import Goo
import System

internal data struct FilePreviewInput {
    var Entry FileEntry
    var Acquire Func[FileEntry, int32, Action, ThumbnailLease]
    var Tile bool
    var Palette Palette
    var WordWrap bool
}
