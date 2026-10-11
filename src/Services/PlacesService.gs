package gloop

import Goo
import System
import System.Collections.Generic

data struct PlacesRequest {
    internal var Volumes bool
    internal var SpacePath string
    internal var VolumesGeneration int32
    internal var SpaceGeneration int32
}

class PlacesService {
    private let window Window
    private let changed Action
    private let gate object = Object()
    private var volumesPending bool
    private var spacePending string = ""
    private var spacePath string = ""
    private var volumesGeneration int32
    private var spaceGeneration int32
    private var running bool
    private var deviceBusy bool
    private var closed bool
    internal var Volumes List[Volume] = List[Volume]()
    internal var TrashCount int32
    internal var Space Volume = Volume{}

    internal init(window Window, changed Action) {
        this.window = window
        this.changed = changed
    }

    internal func Refresh() {
        Submit(true, spacePath)
    }

    internal func Watch(path string) {
        if path != spacePath && !Locations.IsRecent(path) {
            Submit(false, path)
        }
    }

    internal func Mount(volume Volume, done Action[string, string]) {
        StartDevice(volume, true, done)
    }

    internal func Eject(volume Volume, done Action[string, string]) {
        StartDevice(volume, false, done)
    }

    internal func Take() PlacesRequest? {
        lock gate {
            if closed || (!volumesPending && spacePending == "") {
                running = false
                return nil
            }
            let request = PlacesRequest{
                Volumes: volumesPending,
                SpacePath: spacePending,
                VolumesGeneration: volumesGeneration,
                SpaceGeneration: spaceGeneration,
            }
            volumesPending = false
            spacePending = ""
            return request
        }
    }

    internal func Process(request PlacesRequest) {
        var volumes = List[Volume]()
        var trashCount int32
        var space = Volume{}
        if request.Volumes {
            volumes = VolumeService().List()
            trashCount = TrashService().Count()
        }
        if request.SpacePath != "" {
            space = VolumeService().Space(request.SpacePath)
        }
        try {
            window.Post(() -> Apply(request, volumes, trashCount, space))
        } catch (failure Exception) { }
    }

    internal func CompleteDevice(done Action[string, string], path string, error string) {
        if closed {
            return
        }
        deviceBusy = false
        Refresh()
        done(path, error)
    }

    internal func Dispose() {
        lock gate {
            closed = true
        }
    }

    private func Submit(volumes bool, path string) {
        var started bool
        lock gate {
            if closed {
                return
            }
            if volumes {
                volumesPending = true
                volumesGeneration++
            }
            if path != "" {
                spacePath = path
                spacePending = path
                spaceGeneration++
            }
            if !running {
                running = true
                started = true
            }
        }
        if started {
            let owner = window
            let service = this
            go placesWorker(owner, service)
        }
    }

    private func Apply(request PlacesRequest, volumes List[Volume], trashCount int32, space Volume) {
        if closed {
            return
        }
        if request.Volumes && request.VolumesGeneration == volumesGeneration {
            Volumes = volumes
            TrashCount = trashCount
        }
        if request.SpacePath != "" && request.SpaceGeneration == spaceGeneration {
            Space = space
        }
        changed()
    }

    private func StartDevice(volume Volume, mount bool, done Action[string, string]) {
        if closed {
            return
        }
        if deviceBusy {
            done("", "Another disk operation is still running")
            return
        }
        deviceBusy = true
        let owner = window
        let service = this
        go placesDevice(owner, service, volume, mount, done)
    }
}

func placesWorker(window Window, service PlacesService) {
    while let request = service.Take() {
        service.Process(request)
    }
}

func placesDevice(window Window, service PlacesService, volume Volume, mount bool, done Action[string, string]) {
    var path = ""
    var error string
    if mount {
        error = VolumeService().Mount(volume.Device, out path)
    } else {
        error = VolumeService().Eject(volume)
    }
    try {
        window.Post(() -> service.CompleteDevice(done, path, error))
    } catch (failure Exception) { }
}
