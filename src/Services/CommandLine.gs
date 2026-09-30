package gloop

import System
import System.IO

internal class CommandLine {
    shared {
        internal func Parse(args[]string) LaunchOptions {
            let options = LaunchOptions()
            var path = ""
            var positional = false
            for arg in args {
                if !positional && arg == "--" {
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
            if options.Help || options.Version || options.Licenses || options.InstallDesktop || options.SetDefault {
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

        internal func Usage() string -> "Usage: gloop [--hidden] [path]\n       gloop --help\n       gloop --version\n       gloop --licenses\n       gloop --install-desktop\n       gloop --set-default"

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
