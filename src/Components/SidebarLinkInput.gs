package gloop

import Goo
import Goo.Widgets
import System

internal data struct SidebarLinkInput {
    var Icon string
    var Label string
    var Active bool
    var Action Action
    var OnContextMenu Action[Point]?
    var OnContextMenuKey Action[KeyEvent, Point]?
    var DropTarget DropTarget?
    var DropActive bool
    var Muted bool
    var Trailing Blob?
    var Palette Palette
}
