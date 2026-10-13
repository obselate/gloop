package gloop

import System
import System.IO

data struct FileProperties {
    internal var Count int32
    internal var Name string = ""
    internal var Location string = ""
    internal var Kind string = ""
    internal var MimeType string = ""
    internal var Size int64
    internal var Items int32
    internal var Complete bool
    internal var Modified DateTime
    internal var Accessed DateTime
    internal var Created DateTime
    internal var Permissions string = ""
    internal var Mode UnixFileMode
    internal var IsLink bool
    internal var Owner string = ""
    internal var Group string = ""
    internal var LinkTarget string = ""
    internal var Error string = ""
}
