package gloop

import System
import System.Collections.Generic
import System.IO

data struct OperationResult {
    internal var Source string
    internal var FinalPath string
    internal var Error string
    internal var Mode UnixFileMode?
}
