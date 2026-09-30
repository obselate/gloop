package gloop

import System
import System.Collections.Generic

class FileDragPayload {
    internal let Paths IReadOnlyList[string]

    internal init(paths List[string]) {
        Paths = Array.AsReadOnly[string](paths.ToArray())
    }
}
