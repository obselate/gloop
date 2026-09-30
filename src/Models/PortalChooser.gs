package gloop

import System.Collections.Generic

internal class PortalFilterPattern {
    internal var Type uint32
    internal var Value string = ""
}

internal class PortalFilter {
    internal var Name string = ""
    internal let Patterns List[PortalFilterPattern] = List[PortalFilterPattern]()
}

internal class PortalChoiceOption {
    internal var Id string = ""
    internal var Label string = ""
}

internal class PortalChoice {
    internal var Id string = ""
    internal var Label string = ""
    internal var Selected string = ""
    internal let Options List[PortalChoiceOption] = List[PortalChoiceOption]()
}

internal class PortalChoiceResult {
    internal var Id string = ""
    internal var Value string = ""
}

internal class PortalChooserRequest {
    internal var Method string = "OpenFile"
    internal var AppId string = ""
    internal var ParentWindow string = ""
    internal var Title string = ""
    internal var AcceptLabel string = ""
    internal var Modal bool = true
    internal var Multiple bool
    internal var Directory bool
    internal var CurrentFolder string = ""
    internal var CurrentFile string = ""
    internal var CurrentName string = ""
    internal let Files List[string] = List[string]()
    internal let Filters List[PortalFilter] = List[PortalFilter]()
    internal var CurrentFilter PortalFilter?
    internal let Choices List[PortalChoice] = List[PortalChoice]()
}

internal class PortalChooserResult {
    internal var Response uint32 = 1
    internal let Uris List[string] = List[string]()
    internal var CurrentFilter PortalFilter?
    internal let Choices List[PortalChoiceResult] = List[PortalChoiceResult]()
}
