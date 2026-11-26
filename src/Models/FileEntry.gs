package gloop

import System
import System.IO

data struct FileEntry {
    internal var Name string
    internal var FullPath string
    internal var IsDirectory bool
    internal var IsSymlink bool
    internal var Size int64
    internal var Modified DateTime
    internal var Created DateTime
    internal var Kind string
    internal var Permissions string

    internal func ExtensionText() string -> if IsDirectory {
        ""
    } else {
        Path.GetExtension(Name).TrimStart('.').ToUpperInvariant()
    }

    shared {
        internal func FormatDate(value DateTime, culture IFormatProvider? = nil, compact bool = false) string ->
        value.ToString(
            compact ? (value.Date == DateTime.Today ? "'Today' HH:mm": "dd MMM yyyy"): "dd MMM yyyy, HH:mm",
            culture
        )
    }
}
