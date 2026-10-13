package gloop

import System.Collections.Generic

internal class PortalChoice {
    internal var Id string = ""
    internal var Label string = ""
    internal var Selected string = ""
    internal let Options List[PortalChoiceOption] = List[PortalChoiceOption]()
}
