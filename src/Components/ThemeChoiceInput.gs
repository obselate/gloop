package gloop

import Goo
import Goo.Widgets
import System

internal data struct ThemeChoiceInput {
    var Name string
    var Theme ThemePalette
    var Selected bool
    var Keyboard bool
    var Choose Action
}
