package gloop

import Goo
import System

internal class BrowserLaunchService {
    private let window Window
    private let controller BrowserController
    private var terminalOpening bool

    internal init(window Window, controller BrowserController) {
        this.window = window
        this.controller = controller
    }

    internal func OpenSelected() {
        controller.ResetTypeSelect()

        guard let entry = controller.ActivePane().SelectedEntry() else {
            return
        }

        if entry.IsDirectory || ArchiveService.Supported(entry.FullPath) {
            controller.Navigate(entry.FullPath)
        } else if controller.ActivePane().Kind == LocationKind.Archive {
            if !controller.PreviewVisible {
                controller.TogglePreview()
            } else {
                controller.Previews.RequestReload()
                controller.Previews.QueuePreview()
            }
        } else if !controller.InTrashView {
            let owner = window
            let launches = this

            go browserOpen(owner, launches, entry.FullPath)
        }
    }

    internal func OpenTerminal(inSelection bool = true) {
        var directory = controller.ActivePane().DirectoryPath
        var kind = controller.ActivePane().Kind

        if inSelection {
            if let entry = controller.ActivePane().SingleSelectedEntry() {
                if entry.IsDirectory {
                    directory = entry.FullPath
                    kind = LocationKind.Folder
                }
            }
        }

        if controller.IsDisposed || directory == "" || kind == LocationKind.Recent || terminalOpening {
            return
        }

        terminalOpening = true
        let owner = window
        let launches = this

        go browserOpenTerminal(owner, launches, directory)
    }

    internal func CompleteOpen(error string) {
        if controller.IsDisposed {
            return
        }

        controller.Status = error

        controller.Notify()
    }

    internal func CompleteTerminal(error string) {
        terminalOpening = false
        CompleteOpen(error)
    }
}

func browserOpen(window Window, launches BrowserLaunchService, path string) {
    var error string

    try {
        error = FileSystemService().Open(path)
    } catch (failure Exception) {
        error = "Open failed for " + path + ": " + failure.Message
    }

    try {
        window.Post(() -> launches.CompleteOpen(error))
    } catch (failure InvalidOperationException) { }
}

func browserOpenTerminal(window Window, launches BrowserLaunchService, directory string) {
    var error string

    try {
        error = TerminalService().Open(directory)
    } catch (failure Exception) {
        error = "Open terminal failed for " + directory + ": " + failure.Message
    }

    try {
        window.Post(() -> launches.CompleteTerminal(error))
    } catch (failure InvalidOperationException) { }
}
