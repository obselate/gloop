package gloop

import System
import System.IO
import System.Runtime.CompilerServices

internal enum SetupAction {
    Launcher,
    Folders,
    Chooser
}

internal class FirstRunSetup {
    shared {
        internal func ShouldOffer() bool ->
        OperatingSystem.IsLinux() && !RuntimeFeature.IsDynamicCodeSupported && !File.Exists(CompletionPath())

        internal func IsSystemRegistered() bool -> DesktopIntegration.SystemBinary() != ""

        internal func Apply(action SetupAction) {
            RequireNative()
            using let stateLock = AcquireLock()
            if action == SetupAction.Launcher {
                DesktopIntegration.Install()
            } else if action == SetupAction.Folders {
                DesktopIntegration.SetDefault()
            } else if action == SetupAction.Chooser {
                PortalIntegration.Install()
                PortalIntegration.SetDefault()
            } else {
                throw InvalidOperationException("Unknown setup action")
            }
        }

        internal func Complete() {
            RequireNative()
            using let stateLock = AcquireLock()
            let path = CompletionPath()
            let temporary = path + ".new"
            try {
                File.WriteAllText(temporary, "1\n")
                File.Move(temporary, path, true)
            } finally {
                File.Delete(temporary)
            }
        }

        private func DirectoryPath() string ->
        Path.Combine(DesktopIntegration.UserDirectory("XDG_CONFIG_HOME", ".config"), "gloop")

        private func CompletionPath() string -> Path.Combine(DirectoryPath(), "setup-complete")

        private func RequireNative() {
            if !OperatingSystem.IsLinux() || RuntimeFeature.IsDynamicCodeSupported {
                throw InvalidOperationException("Desktop setup requires the published Linux NativeAOT executable")
            }
        }

        private func AcquireLock() FileStream {
            let directory = DirectoryPath()
            Directory.CreateDirectory(directory)
            try {
                return FileStream(
                    Path.Combine(directory, "setup.lock"),
                    FileMode.OpenOrCreate,
                    FileAccess.ReadWrite,
                    FileShare.None
                )
            } catch (failure IOException) {
                throw InvalidOperationException(
                    "Another Gloop window may be applying setup. Try again when it finishes.",
                    failure
                )
            }
        }
    }
}
