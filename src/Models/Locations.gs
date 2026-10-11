package gloop

import System

class Locations {
    shared {
        internal const Recent string = "recent:"

        internal func IsRecent(path string) bool -> path.Trim().Equals(Recent, StringComparison.OrdinalIgnoreCase)
    }
}
