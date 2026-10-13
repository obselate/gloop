package gloop

import Goo
import Goo.Widgets.Inputs
import Goo.Widgets.Layout
import System
import System.Collections.Generic

internal data struct FileChooserBarInput {
    var Request PortalChooserRequest
    var Name string
    var OnNameChange Action[string]
    var NameHandle ElementHandle
    var FilterIndex int32
    var OnFilterChange Action[int32]
    var Choices IReadOnlyDictionary[string, string]
    var OnChoiceChange Action[string, string]
    var Summary string
    var Error string
    var OnAccept Action
    var OnCancel Action
    var OverlayHost ElementHandle
    var Host Window
    var Palette Palette
}
