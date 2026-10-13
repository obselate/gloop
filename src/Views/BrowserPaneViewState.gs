package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Layout
import System
import System.Collections.Generic
import System.IO

class BrowserPaneViewState {
    internal let Pane BrowserPane
    internal let ListFocus ElementHandle = ElementHandle()
    internal let TileFocus ElementHandle = ElementHandle()
    internal let ListViewport ElementHandle = ElementHandle()
    internal let TileViewport ElementHandle = ElementHandle()
    internal var ColumnWidths Dictionary[string, float64] = Dictionary[string, float64]()
    internal var Selection string = ""
    internal var RevealPending bool

    internal init(pane BrowserPane) {
        Pane = pane
    }
}
