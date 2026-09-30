package gloop

import System

data struct FileEntry {
    internal var Name string
    internal var FullPath string
    internal var IsDirectory bool
    internal var IsSymlink bool
    internal var Size int64
    internal var Modified DateTime
    internal var Kind string
}
