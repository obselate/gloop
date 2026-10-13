package gloop

import System
import System.Collections.Generic
import System.IO

data struct OperationRequest {
    internal var Kind OperationKind
    internal var Sources List[string]
    internal var Destination string
    internal var Name string
    internal var ClipboardVersion int32
    internal var Permission UnixFileMode
    internal var Enabled bool
    internal var Names List[string]
    internal var Completed Action[List[OperationResult]]?
}
