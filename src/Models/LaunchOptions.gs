package gloop

internal class LaunchOptions {
    internal var DirectoryPath string
    internal var SelectedPath string
    internal var ShowHidden bool
    internal var Help bool
    internal var Version bool
    internal var Licenses bool
    internal var InstallDesktop bool
    internal var SetDefault bool
    internal var Error string

    internal init() {
        DirectoryPath = ""
        SelectedPath = ""
        Error = ""
    }
}
