package gloop

import Goo
import Goo.Widgets.Data
import System
import System.Collections
import System.Collections.Generic
import System.Linq

internal data struct FileTileItem {
    var Entry FileEntry
    var Index int32
    var Selected bool
    var Focused bool
    var DropActive bool
    var Palette Palette
    var WordWrap bool
}
