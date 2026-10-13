package gloop

import System.Collections.Generic

internal class PortalChooserResult {
    internal var Response uint32 = 1
    internal let Uris List[string] = List[string]()
    internal var CurrentFilter PortalFilter?
    internal let Choices List[PortalChoiceResult] = List[PortalChoiceResult]()
}
