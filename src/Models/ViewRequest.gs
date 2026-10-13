package gloop

import System
import System.Collections.Generic

data struct ViewRequest {
    internal var Pane BrowserPane
    internal var Generation int32
    internal var Entries List[FileEntry]
    internal var Filter string
    internal var EntryFilter Func[FileEntry, bool]?
    internal var Column SortColumn
    internal var Descending bool
    internal var SelectedPath string
}
