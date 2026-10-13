package gloop

import Goo
import System

internal data struct PreviewSidebarInput {
    var Title string
    var Preview PreviewData
    var Image ImageSource?
    var Entry FileEntry?
    var SizeText string
    var Detail string
    var WordWrap bool
    var LineNumbers bool
    var Close Action
}
