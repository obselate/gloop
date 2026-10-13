package gloop

import System
import System.Collections.Generic

data struct DirectoryRequest {
    internal var Pane BrowserPane
    internal var Generation int32
    internal var Path string
    internal var Kind LocationKind
    internal var AtTrashRoot bool
    internal var ShowHidden bool
    internal var Mode string
    internal var HistoryIndex int32
    internal var SelectedPath string
}
