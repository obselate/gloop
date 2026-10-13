package gloop

import System
import System.Collections.Generic

data struct OperationRequest {
    internal var Kind OperationKind
    internal var Sources List[string]
    internal var Destination string
    internal var Name string
    internal var ClipboardVersion int32
}
