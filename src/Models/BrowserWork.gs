package gloop

import System.Collections.Generic

data struct PreviewRequest {
    internal var Path string
    internal var Generation int32
}

data struct DirectoryRequest {
    internal var Index int32
    internal var Generation int32
    internal var Path string
    internal var ShowHidden bool
    internal var Mode string
    internal var HistoryIndex int32
    internal var SelectedPath string
}

data struct ViewRequest {
    internal var Index int32
    internal var Generation int32
    internal var Entries List[FileEntry]
    internal var Filter string
    internal var Column string
    internal var Descending bool
    internal var SelectedPath string
}

data struct OperationRequest {
    internal var Kind string
    internal var Sources List[string]
    internal var Destination string
    internal var Name string
    internal var ClipboardVersion int32
}
