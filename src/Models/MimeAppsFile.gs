package gloop

import System
import System.Collections.Generic

data struct MimeAppsFile {
    internal var Defaults Dictionary[string, string]
    internal var Added Dictionary[string, string]
    internal var Removed Dictionary[string, string]
}
