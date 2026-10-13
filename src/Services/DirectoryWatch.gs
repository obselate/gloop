package gloop

import Goo
import System
import System.ComponentModel
import System.Runtime.InteropServices

unsafe class DirectoryWatch {
    private const QuietMilliseconds int32 = 150
    private const MaximumMilliseconds int32 = 350
    private const IdlePollMilliseconds int32 = 1000
    private const BufferBytes int32 = 65536
    private const NonBlockingCloseOnExec int32 = 0x80800
    private const ChangeMask uint32 = 0xfce
    private const Interrupted int32 = 4
    private const WouldBlock int32 = 11

    private let window Window
    private let path string
    private let changed Action[string]
    private let gate object = Object()
    private var closed bool
    private var posted bool

    internal init(window Window, path string, changed Action[string]) {
        this.window = window
        this.path = path
        this.changed = changed

        go Run()
    }

    internal func Close() {
        lock gate {
            closed = true
        }
    }

    private func IsClosed() bool {
        lock gate {
            return closed
        }
    }

    private func Post(error string) bool {
        lock gate {
            if closed {
                return false
            }
            if posted {
                return true
            }

            posted = true
        }

        try {
            window.Post(
                () -> {
                    lock gate {
                        posted = false

                        if closed {
                            return
                        }
                    }

                    changed(error)
                }
            )
        } catch (failure InvalidOperationException) {
            Close()
        }

        return true
    }

    private func Run() {
        var descriptor = -1

        try {
            descriptor = initialize(NonBlockingCloseOnExec)

            if descriptor < 0 || addWatch(descriptor, path, ChangeMask) < 0 {
                throw Win32Exception(Marshal.GetLastWin32Error())
            }

            let raw *uint8 = stackalloc[BufferBytes]uint8
            let buffer = IntPtr(raw)
            let pollRaw *uint8 = stackalloc[8]uint8
            let pollBuffer = IntPtr(pollRaw)
            Marshal.WriteInt32(pollBuffer, descriptor)
            Marshal.WriteInt16(pollBuffer, 4, 1)
            var firstChange int64
            var lastChange int64
            var dirty bool

            while !IsClosed() {
                let beforePoll = Environment.TickCount64
                let timeout = if dirty {
                    int32(
                        Math.Max(
                            0,
                            Math.Min(
                                QuietMilliseconds - (beforePoll - lastChange),
                                MaximumMilliseconds - (beforePoll - firstChange)
                            )
                        )
                    )
                } else {
                    IdlePollMilliseconds
                }
                let ready = poll(pollBuffer, 1, timeout)

                if ready < 0 && Marshal.GetLastWin32Error() != Interrupted {
                    throw Win32Exception(Marshal.GetLastWin32Error())
                }

                if ready > 0 {
                    let count = read(descriptor, buffer, nuint(BufferBytes))

                    if count < 0 && Marshal.GetLastWin32Error() != WouldBlock &&
                        Marshal.GetLastWin32Error() != Interrupted {
                        throw Win32Exception(Marshal.GetLastWin32Error())
                    }

                    if count > 0 {
                        lastChange = Environment.TickCount64

                        if !dirty {
                            firstChange = lastChange
                            dirty = true
                        }
                    }
                }

                let now = Environment.TickCount64

                if dirty && (now - lastChange >= QuietMilliseconds || now - firstChange >= MaximumMilliseconds) {
                    if Post("") {
                        dirty = false
                    }
                }
            }
        } catch (failure Exception) {
            Post("Watch folder failed for " + path + ": " + failure.Message)
        } finally {
            if descriptor >= 0 && closeDescriptor(descriptor) != 0 {
                Post(
                    "Close folder watch failed for " + path + ": " + Win32Exception(Marshal.GetLastWin32Error()).Message
                )
            }
        }
    }

    shared {
        @DllImport("libc", EntryPoint: "inotify_init1", SetLastError: true)
        private func initialize(flags int32) int32;

        @DllImport("libc", EntryPoint: "inotify_add_watch", CharSet: CharSet.Ansi, SetLastError: true)
        private func addWatch(descriptor int32, path string, mask uint32) int32;

        @DllImport("libc", EntryPoint: "poll", SetLastError: true)
        private func poll(descriptors IntPtr, count nuint, milliseconds int32) int32;

        @DllImport("libc", EntryPoint: "read", SetLastError: true)
        private func read(descriptor int32, buffer IntPtr, count nuint) nint;

        @DllImport("libc", EntryPoint: "close", SetLastError: true)
        private func closeDescriptor(descriptor int32) int32;
    }
}
