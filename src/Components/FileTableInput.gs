package gloop

import Goo
import Goo.Widgets
import Goo.Widgets.Data
import System
import System.Collections.Generic

internal data struct FileTableInput {
    var Host Window
    var Pane BrowserPane
    var Location LocationKind
    var Compact bool
    var ShowType bool
    var SizeText Func[FileEntry, string]
    var OnHeaderMenu Action[Point]
    var Tiles bool
    var TileWidth float64
    var WordWrap bool
    var Active bool
    var AutoFocus bool
    var Choosing bool
    var DirectoriesOnly bool
    var FocusHandle ElementHandle
    var ViewportHandle ElementHandle
    var OnKey Action[KeyEvent]
    var Keys[]KeyBinding
    var ColumnWidths IReadOnlyDictionary[string, float64]
    var OnFittedColumnWidthsChange Action[IReadOnlyDictionary[string, float64]]
    var OnFocusRow Action[int32]
    var OnSelect Action[int32, bool, bool]
    var OnDrag((string) -> DragData?)
    var OnDragEnd Action
    var DropTarget Func[string, DropTarget]
    var DropPath string
    var OnClear Action
    var OnContextMenu Action[int32, Point]
    var AcquireThumbnail Func[FileEntry, int32, Action, ThumbnailLease]
    var OnOpen Action
    var OnSort Action[string]
    var OnText Action[string]
    var Palette Palette
}
