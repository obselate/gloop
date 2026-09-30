package gloop

import System.Collections.Generic

class DirectorySnapshot {
    internal var DirectoryPath string
    internal var Entries List[FileEntry]
    internal var Error string

    internal init() {
        DirectoryPath = ""
        Entries = List[FileEntry]()
        Error = ""
    }
}
