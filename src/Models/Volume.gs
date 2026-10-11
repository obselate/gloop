package gloop

data struct Volume {
    internal var Name string = ""
    internal var MountPath string = ""
    internal var Device string = ""
    internal var Removable bool
    internal var Ejectable bool
    internal var TotalBytes int64
    internal var FreeBytes int64
}
