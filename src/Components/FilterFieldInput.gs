package gloop

import Goo
import System

internal data struct FilterFieldInput {
    var Value string
    var Width float64
    var Handle ElementHandle
    var Palette Palette
    var OnChange Action[string]
    var OnSubmit Action
}
