package gloop

import System
import System.IO

internal class CommandLine {
    shared {
        internal func Parse(args[]string) LaunchOptions {
            let options = LaunchOptions()
            var path = ""
            var positional = false
            var pendingOption = ""
            for arg in args {
                if pendingOption != "" {
                    if pendingOption == "--chooser-request" {
                        options.ChooserRequestPath = arg
                    } else {
                        options.ChooserResultPath = arg
                    }
                    pendingOption = ""
                } else if !positional && (arg == "--chooser-request" || arg == "--chooser-result") {
                    pendingOption = arg
                } else if !positional && arg == "--" {
                    positional = true
                } else if !positional && (arg == "--help" || arg == "-h") {
                    options.Help = true
                } else if !positional && arg == "--version" {
                    options.Version = true
                } else if !positional && arg == "--licenses" {
                    options.Licenses = true
                } else if !positional && arg == "--install-desktop" {
                    options.InstallDesktop = true
                } else if !positional && arg == "--set-default" {
                    options.SetDefault = true
                } else if !positional && arg == "--install-portal" {
                    options.InstallPortal = true
                } else if !positional && arg == "--portal" {
                    options.Portal = true
                } else if !positional && arg == "--set-default-chooser" {
                    options.SetDefaultChooser = true
                } else if !positional && arg == "--restore-default-chooser" {
                    options.RestoreDefaultChooser = true
                } else if !positional && arg == "--hidden" {
                    options.ShowHidden = true
                } else if !positional && arg.StartsWith("-") {
                    options.Error = "Unknown option: " + arg
                    return options
                } else if path != "" {
                    options.Error = "Expected one path, received more than one"
                    return options
                } else {
                    path = arg
                }
            }
            if pendingOption != "" {
                options.Error = "Expected a path after " + pendingOption
                return options
            }
            if (options.ChooserRequestPath == "") != (options.ChooserResultPath == "") {
                options.Error = "Chooser mode requires --chooser-request and --chooser-result"
                return options
            }
            if options.Portal ||
                options.Help ||
                options.Version ||
                options.Licenses ||
                options.InstallDesktop ||
                options.SetDefault ||
                options.InstallPortal ||
                options.SetDefaultChooser ||
                options.RestoreDefaultChooser {
                return options
            }
            try {
                let fullPath = Path.GetFullPath(path == "" ? ".": path)
                if Directory.Exists(fullPath) {
                    options.DirectoryPath = fullPath
                } else if File.Exists(fullPath) {
                    options.DirectoryPath = Path.GetDirectoryName(fullPath) ?? ""
                    options.SelectedPath = fullPath
                } else {
                    options.Error = "Path does not exist: " + fullPath
                }
            } catch (e Exception) {
                options.Error = "Invalid path: " + path
            }
            return options
        }

        internal func Usage() string -> "Usage: gloop [--hidden] [path]\n       gloop --help\n       gloop --version\n       gloop --licenses\n       gloop --install-desktop\n       gloop --set-default\n       gloop --install-portal\n       gloop --set-default-chooser\n       gloop --restore-default-chooser"

        internal func AppVersion() string -> typeof(CommandLine).Assembly.GetName().Version?.ToString(3) ?? "0.0.0"

        internal func VersionText() string -> "gloop " + AppVersion()

        internal func LicenseText() string {
            if let stream = typeof(CommandLine).Assembly.GetManifestResourceStream("gloop.ThirdPartyNotices.txt") {
                using let reader = StreamReader(stream)
                return reader.ReadToEnd()
            }
            throw InvalidOperationException("Embedded license notices are missing")
        }
    }
}
