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
    if launch.InstallDesktop {
        try {
            Console.WriteLine(DesktopIntegration.Install())
            return 0
        } catch (e Exception) {
            Console.Error.WriteLine("Desktop installation failed: " + e.Message)
            return 1
        }
    }
    let service = SettingsService.Default()
    let loaded = service.Load()
    if launch.ShowHidden {
        loaded.Settings.ShowHidden = true
    }
    Window.ConfigureApplication("Gloop", CommandLine.AppVersion(), "io.github.obselate.gloop")
    let view = BrowserView(loaded.Settings, service, launch, loaded.Error)
    let window = Window{
        Title: launch.DirectoryPath,
        IconPng: AppIcon.Bytes(),
        Decorated: false,
        NativeFileDropEnabled: true,
        Width: 1180,
        Height: 760,
        MinWidth: 600,
        MinHeight: 400,
        Root: view,
        OnClosing: () -> view.CloseSafely(),
        Background: Color.Parse(loaded.Settings.Theme.Background),
    }
    view.Attach(window)
    try {
        window.Run()
    } finally {
        view.Shutdown()
    }
    return 0
}
