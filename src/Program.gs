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
        return FileChooserPortal.Run()
    }
    if launch.InstallDesktop ||
        launch.SetDefault ||
        launch.InstallPortal ||
        launch.SetDefaultChooser ||
        launch
        .RestoreDefaultChooser {
        try {
            if !launch.RestoreDefaultChooser {
                Console.WriteLine(DesktopIntegration.Install())
            }
            if launch.SetDefault {
                Console.WriteLine(DesktopIntegration.SetDefault())
            }
            if launch.InstallPortal || launch.SetDefaultChooser {
                Console.WriteLine(PortalIntegration.Install())
            }
            if launch.SetDefaultChooser {
                Console.WriteLine(PortalIntegration.SetDefault())
            }
            if launch.RestoreDefaultChooser {
                Console.WriteLine(PortalIntegration.RestoreDefault())
            }
            return 0
        } catch (e Exception) {
            Console.Error.WriteLine("Desktop installation failed: " + e.Message)
            return 1
        }
    }
    if launch.ChooserRequestPath != "" {
        try {
            launch.ChooserRequest = PortalChooserCodec.ReadRequest(launch.ChooserRequestPath)
        } catch (e Exception) {
            Console.Error.WriteLine("Could not load chooser request: " + e.Message)
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
        settings.ShowHidden = true
    }
    Window.ConfigureApplication("Gloop", CommandLine.AppVersion(), "io.github.obselate.gloop")
    let view = BrowserView(settings, service, launch, loaded.Error)
    let parent = launch.ChooserRequest?.ParentWindow ?? ""
    let window = Window{
        Title: launch.ChooserRequest?.Title ?? launch.DirectoryPath,
        IconPng: AppIcon.Bytes(),
        Decorated: false,
        ForeignParentHandle: parent,
        Modal: (launch.ChooserRequest?.Modal ?? false) && parent != "",
        NativeFileDropEnabled: launch.ChooserRequest == nil,
        Width: 1180,
        Height: 760,
        MinWidth: 600,
        MinHeight: 400,
        Root: view,
        OnClosing: () -> view.CloseSafely(),
        Background: Color.Parse(settings.Theme.Background),
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
            Console.Error.WriteLine("Could not write chooser result: " + e.Message)
            return 2
        }
    }
    return 0
}
