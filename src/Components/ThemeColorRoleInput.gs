package gloop

import Goo
import Goo.Widgets
import System

internal data struct ThemeColorRoleInput {
    var Role string
    var Value string
    var Selected bool
    var Choose Action
    var Palette Palette
}
