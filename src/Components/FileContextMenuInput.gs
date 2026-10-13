package gloop

import Goo
import Goo.Widgets.Navigation
import System

internal data struct FileContextMenuInput {
    var Open bool
    var Point Point
    var Name string
    var Items[]MenuItem
    var OnActivate Action[string]
    var OnDismiss Action
    var Palette Palette
}
