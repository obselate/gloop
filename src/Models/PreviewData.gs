package gloop

data struct PreviewData {
    internal var Kind PreviewKind = PreviewKind.None
    internal var Text string = ""
    internal var Path string = ""
    internal var Error string = ""
    internal var Warning string = ""
    internal var Styles[]PreviewStyleSpan = []PreviewStyleSpan{}
}
