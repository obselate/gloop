package gloop

import Goo
import System

func Main(args[]string) int32 {
    let launch = CommandLine.Parse(args)

    if launch.Error != "" {
        Console.Error.WriteLine(launch.Error)
        Console.Error.WriteLine(CommandLine.Usage())

        return 2
    }

    if launch.Help {
        Console.WriteLine(CommandLine.Usage())

        return 0
    }

    if launch.Version {
        Console.WriteLine(CommandLine.VersionText())

        return 0
    }

    if launch.Licenses {
        Console.Write(CommandLine.LicenseText())

        return 0
    }

    if launch.Portal {
        try {
            return FileChooserPortal.Run()
        } catch (e Exception) {
            Console.Error.WriteLine(
                "Run file chooser portal failed for " + FileChooserPortal.BusName + ": " + e.Message
            )

            return 1
        }
    }

    if launch.InstallDesktop ||
        launch.SetDefault ||
        launch.InstallPortal ||
        launch.SetDefaultChooser ||
        launch
        .RestoreDefaultChooser {
        var operation = "Install desktop entry"

        try {
            if !launch.RestoreDefaultChooser {
                Console.WriteLine(DesktopIntegration.Install())
            }

            if launch.SetDefault {
                operation = "Set default file manager"
                Console.WriteLine(DesktopIntegration.SetDefault())
            }

            if launch.InstallPortal || launch.SetDefaultChooser {
                operation = "Register portal"
                Console.WriteLine(PortalIntegration.Install())
            }

            if launch.SetDefaultChooser {
                operation = "Set default file chooser"
                Console.WriteLine(PortalIntegration.SetDefault())
            }

            if launch.RestoreDefaultChooser {
                operation = "Restore default file chooser"
                Console.WriteLine(PortalIntegration.RestoreDefault())
            }

            return 0
        } catch (e Exception) {
            Console.Error.WriteLine(operation + " failed: " + e.Message)

            return 1
        }
    }

    if launch.ChooserRequestPath != "" {
        try {
            launch.ChooserRequest = PortalChooserCodec.ReadRequest(launch.ChooserRequestPath)
        } catch (e Exception) {
            Console.Error.WriteLine("Load chooser request failed for " + launch.ChooserRequestPath + ": " + e.Message)

            return 2
        }
    }

    let service = SettingsService.Default()
    let loaded = service.Load()
    let settings = launch.ChooserRequest != nil ? loaded.Settings.Clone(): loaded.Settings

    if launch.ChooserRequest != nil {
        settings.SplitView = false
    }

    if launch.ShowHidden {
        settings.LaunchShowHiddenOriginal = settings.ShowHidden
        settings.ShowHidden = true
    }

    Window.ConfigureApplication("Gloop", CommandLine.AppVersion(), "io.github.obselate.gloop")

    let view = BrowserView(settings, service, launch, loaded.Error)
    let parent = launch.ChooserRequest?.ParentWindow ?? ""
    let window = Window{
        Title: launch.ChooserRequest?.Title ?? launch.DirectoryPath,
        IconPng: AppIcon.Bytes(),
        Decorated: false,
        Transparent: true,
        ForeignParentHandle: parent,
        Modal: (launch.ChooserRequest?.Modal ?? false) && parent != "",
        NativeFileDropEnabled: launch.ChooserRequest == nil,
        Width: BrowserView.DefaultWidth,
        Height: BrowserView.DefaultHeight,
        MinWidth: 600,
        MinHeight: 400,
        Root: view,
        OnClosing: () -> view.CloseSafely(),
    }

    view.Attach(window)

    try {
        window.Run()
    } finally {
        view.Shutdown()
    }

    if launch.ChooserRequest != nil {
        try {
            PortalChooserCodec.WriteResult(launch.ChooserResultPath, view.ChooserResult)
        } catch (e Exception) {
            Console.Error.WriteLine("Write chooser result failed for " + launch.ChooserResultPath + ": " + e.Message)

            return 2
        }
    }

    return 0
}
