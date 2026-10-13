package gloop

import System.Collections.Generic

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
