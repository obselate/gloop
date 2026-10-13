package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

internal data struct BreadcrumbInput {
    var Path string
    var Kind LocationKind
    var Trash string
    var Home string
    var Width float64
    var Window Window
    var Palette Palette
    var Navigate Action[string]
    var Edit Action
    var More Action[[]string, Point]
}
