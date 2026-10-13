package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Colors
import System

internal data struct ThemeColorEditorInput {
    var Role string
    var Value int32
    var WheelSize float64
    var Gap float64
    var FocusColor Color
    var ShowFocus bool
    var Change Action[int32]
}
