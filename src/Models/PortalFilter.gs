package gloop

import System.Collections.Generic

internal class PortalFilter {
    internal var Name string = ""
    internal let Patterns List[PortalFilterPattern] = List[PortalFilterPattern]()
}
