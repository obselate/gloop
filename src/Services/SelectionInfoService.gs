package gloop

import Goo
import System
import System.Collections.Generic

class SelectionInfoService {
    private let window Window
    private let applications ApplicationService
    private let properties PropertiesService
    private let applicationWork LatestWork = LatestWork()
    private let propertiesWork LatestWork = LatestWork()
    private let gate object = Object()
    private var launching bool

    internal init(window Window) {
        this.window = window
        applications = ApplicationService()
        properties = PropertiesService(applications)
    }

    internal func LoadApplications(path string, done Action[List[AppChoice], string]) {
        let work = applicationWork
        let service = applications
        let owner = window

        work.Submit(
            generation -> {
                let choices = service.Applications(path)
                choices.RemoveAll(choice -> choice.Id == DesktopIntegration.AppId + ".desktop")

                deliver(
                    owner,
                    work,
                    generation,
                    () -> done(
                        choices,
                        choices.Count == 0 ? "Open With failed for " + path + ": No matching applications": ""
                    )
                )
            },
            (generation, failure) -> deliver(
                owner,
                work,
                generation,
                () -> done(List[AppChoice](), "Cannot load applications for " + path + ": " + failure.Message)
            )
        )
    }

    internal func CancelApplications() {
        applicationWork.Cancel()
    }

    internal func Describe(paths List[string], early Action[FileProperties], done Action[FileProperties]) {
        let work = propertiesWork
        let service = properties
        let owner = window

        work.Submit(
            generation -> {
                let result = service.Describe(
                    paths,
                    () -> !work.IsCurrent(generation),
                    partial -> deliver(owner, work, generation, () -> early(partial))
                )

                deliver(owner, work, generation, () -> done(result))
            },
            (generation, failure) -> deliver(
                owner,
                work,
                generation,
                () -> done(
                    FileProperties{
                        Count: paths.Count,
                        Error: "Read properties failed for " + String.Join(", ", paths) + ": " + failure.Message
                    }
                )
            )
        )
    }

    internal func CancelDescribe() {
        propertiesWork.Cancel()
    }

    internal func Launch(id string, paths List[string], done Action[string]) {
        lock gate {
            if launching {
                return
            }

            launching = true
        }

        let owner = window
        let service = applications
        let session = this

        go launchWorker(owner, session, service, id, paths, done)
    }

    internal func FinishLaunch() {
        lock gate {
            launching = false
        }
    }

    internal func Dispose() {
        applicationWork.Close()
        propertiesWork.Close()
    }

    shared {
        private func deliver(owner Window, work LatestWork, generation int32, apply Action) {
            try {
                owner.Post(
                    () -> {
                        if work.IsCurrent(generation) {
                            apply()
                        }
                    }
                )
            } catch (failure InvalidOperationException) { }
        }
    }
}

func launchWorker(
    window Window,
    session SelectionInfoService,
    service ApplicationService,
    id string,
    paths List[string],
    done Action[string]
) {
    var error string

    try {
        error = service.Launch(id, paths)
    } catch (failure Exception) {
        error = "Open With failed for " + String.Join(", ", paths) + ": " + failure.Message
    }

    session.FinishLaunch()

    try {
        window.Post(() -> done(error))
    } catch (failure InvalidOperationException) { }
}
