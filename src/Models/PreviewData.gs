package gloop

data struct PreviewData {
    internal var Kind string = ""
    internal var Text string = ""
    internal var Path string = ""
    internal var Error string = ""
    internal var Language string = ""
    internal var Warning string = ""
    internal var Styles[]PreviewStyleSpan = []PreviewStyleSpan{}
}

data struct PreviewStyleSpan {
    internal var Start int32
    internal var Length int32
    internal var Kind string
}
