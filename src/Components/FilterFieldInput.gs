package gloop

import Goo
import System

internal data struct FilterFieldInput {
    var Value string
    var Width Length
    var MatchCount int32
    var TotalCount int32
    var Handle ElementHandle
    var Window Window
    var Palette Palette
    var OnChange Action[string]
    var OnClear Action
    var OnMoveSelection Action[int32]
    var OnSubmit Action
}
