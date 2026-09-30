package gloop

import System
import System.Collections.Generic
import System.Diagnostics
import System.IO
import System.Runtime.InteropServices
import System.Text
import System.Threading.Tasks
import Tmds.DBus.Protocol

internal class FileChooserPortal : IPathMethodHandler {
    internal const BusName string = "org.freedesktop.impl.portal.desktop.gloop"
    private const ChooserInterface string = "org.freedesktop.impl.portal.FileChooser"
    private const RequestInterface string = "org.freedesktop.impl.portal.Request"
    private let frontend NameOwnerWatcher
    private let gate object = Object()
    private let pending List[PortalCall] = List[PortalCall]()
    private let requests Dictionary[string, PortalCall] = Dictionary[string, PortalCall]()
    private var active PortalCall?
    private var child Process?
    private var running bool
    private var stopped bool
    private var completion chan[bool]?

    internal init(frontend NameOwnerWatcher) {
        this.frontend = frontend
    }

    public prop Path string {
        get -> "/org/freedesktop/portal/desktop"
    }

    public prop HandlesChildPaths bool {
        get -> true
    }

    public func HandleMethodAsync(context MethodContext) ValueTask {
        let message = context.Request
        let path = message.PathAsString ?? ""
        if context.IsDBusIntrospectRequest {
            ReplyIntrospection(context, path)
        } else if path != Path {
            if message.InterfaceAsString == RequestInterface &&
                message.MemberAsString == "Close" &&
                message.SignatureAsString == "" {
                CloseRequest(context, path)
            } else {
                context.ReplyUnknownMethodError()
            }
        } else if message.InterfaceAsString == ChooserInterface &&
            message.SignatureAsString == "osssa{sv}" &&
            (
            message.MemberAsString == "OpenFile" ||
                message.MemberAsString == "SaveFile" ||
                message.MemberAsString == "SaveFiles"
        ) {
            let owner = frontend.GetCurrentOwner()
            if owner == nil || message.SenderAsString != NameOwnerWatcher.GetOwnerBusName(owner) {
                context.ReplyError(
                    "org.freedesktop.DBus.Error.AccessDenied",
                    "Only the desktop portal may request a file chooser"
                )
                return ValueTask()
            }
            try {
                Submit(PortalMessages.Read(context))
            } catch (error Exception) {
                Console.Error.WriteLine("Invalid file chooser request: " + error.Message)
                PortalMessages.Reply(context, PortalChooserResult{Response: 2})
            }
        } else if context.IsPropertiesInterfaceRequest {
            ReplyProperties(context)
        } else {
            context.ReplyUnknownMethodError()
        }
        return ValueTask()
    }

    private func Submit(call PortalCall) {
        var done chan[bool]?
        lock gate {
            if stopped || requests.Count >= 16 || requests.ContainsKey(call.Handle) {
                PortalMessages.Reply(call.Context, PortalChooserResult{Response: 2})
                return
            }
            call.Context.DisposesAsynchronously = true
            requests.Add(call.Handle, call)
            pending.Add(call)
            if !running {
                running = true
                done = chan[bool](1)
                completion = done
            }
        }
        if let finished = done {
            go Work(finished)
        }
    }

    private func Work(done chan[bool]) {
        try {
            while true {
                var call PortalCall?
                lock gate {
                    if pending.Count == 0 {
                        running = false
                        completion = nil
                        return
                    }
                    call = pending[0]
                    pending.RemoveAt(0)
                    active = call
                }
                guard let current = call else {
                    continue
                }
                var result = PortalChooserResult()
                try {
                    if !Canceled(current) {
                        result = Choose(current)
                    }
                    lock gate {
                        if stopped || current.Canceled {
                            result = PortalChooserResult()
                        }
                        PortalMessages.Reply(current.Context, result)
                        requests.Remove(current.Handle)
                    }
                } catch (error Exception) {
                    try {
                        PortalMessages.Reply(current.Context, PortalChooserResult{Response: Canceled(current) ? 1: 2})
                    } catch (closed Exception) { }
                    if !Canceled(current) {
                        Console.Error.WriteLine("File chooser failed: " + error.Message)
                    }
                } finally {
                    current.Context.Dispose()
                    lock gate {
                        requests.Remove(current.Handle)
                        active = nil
                        child = nil
                    }
                }
            }
        } finally {
            done.Close()
        }
    }

    private func Choose(call PortalCall) PortalChooserResult {
        let directory = System.IO.Directory.CreateTempSubdirectory("gloop-chooser-").FullName
        try {
            let input = System.IO.Path.Combine(directory, "request.json")
            let output = System.IO.Path.Combine(directory, "result.json")
            PortalChooserCodec.WriteRequest(input, call.Request)
            File.SetUnixFileMode(input, UnixFileMode.UserRead | UnixFileMode.UserWrite)
            let start = ProcessStartInfo(
                Environment.ProcessPath ?? throw InvalidOperationException("Cannot locate Gloop executable")
            )
            start.UseShellExecute = false
            start.Environment.Remove("XDG_ACTIVATION_TOKEN")
            start.ArgumentList.Add("--chooser-request")
            start.ArgumentList.Add(input)
            start.ArgumentList.Add("--chooser-result")
            start.ArgumentList.Add(output)
            using let process = Process()
            process.StartInfo = start
            lock gate {
                if stopped || call.Canceled {
                    return PortalChooserResult()
                }
                if !process.Start() {
                    throw InvalidOperationException("Could not start file chooser")
                }
                child = process
            }
            process.WaitForExit()
            lock gate {
                child = nil
            }
            if Canceled(call) {
                return PortalChooserResult()
            }
            if process.ExitCode != 0 || !File.Exists(output) {
                return PortalChooserResult{Response: 2}
            }
            let result = PortalChooserCodec.ReadResult(output)
            ValidateResult(call.Request, result)
            return result
        } finally {
            System.IO.Directory.Delete(directory, true)
        }
    }

    private func Canceled(call PortalCall) bool {
        lock gate {
            return stopped || call.Canceled
        }
    }

    private func CloseRequest(context MethodContext, path string) {
        lock gate {
            if !requests.ContainsKey(path) {
                context.ReplyError("org.freedesktop.DBus.Error.UnknownObject", "Request is no longer active")
                return
            }
            let call = requests[path]
            if context.Request.SenderAsString != call.Sender {
                context.ReplyError(
                    "org.freedesktop.DBus.Error.AccessDenied",
                    "Only the requesting connection may close this dialog"
                )
                return
            }
            Cancel(call)
        }
        using let writer = context.CreateReplyWriter(nil)
        context.Reply(writer.CreateMessage())
    }

    private func CancelSender(sender string) {
        lock gate {
            for call in requests.Values {
                if call.Sender == sender {
                    Cancel(call)
                }
            }
        }
    }

    private func Cancel(call PortalCall) {
        call.Canceled = true
        if call == active && child != nil {
            try {
                child?.Kill(true)
            } catch (error InvalidOperationException) { }
        }
    }

    private func Stop() {
        var done chan[bool]?
        lock gate {
            stopped = true
            for call in requests.Values {
                Cancel(call)
            }
            done = completion
        }
        if let finished = done {
            <-finished
        }
    }

    private func ReplyProperties(context MethodContext) {
        let reader = context.Request.GetBodyReader()
        if context.Request.MemberAsString == "Get" && context.Request.SignatureAsString == "ss" {
            let iface = reader.ReadString()
            let property = reader.ReadString()
            if iface != ChooserInterface || property != "version" {
                context.ReplyError("org.freedesktop.DBus.Error.UnknownProperty", "Unknown file chooser property")
                return
            }
            using let writer = context.CreateReplyWriter("v")
            writer.WriteVariant(VariantValue.UInt32(1))
            context.Reply(writer.CreateMessage())
        } else if context.Request.MemberAsString == "GetAll" && context.Request.SignatureAsString == "s" {
            if reader.ReadString() != ChooserInterface {
                context.ReplyError("org.freedesktop.DBus.Error.UnknownInterface", "Unknown file chooser interface")
                return
            }
            let values = Dictionary[string, VariantValue]()
            values["version"] = VariantValue.UInt32(1)
            using let writer = context.CreateReplyWriter("a{sv}")
            writer.WriteDictionary(values)
            context.Reply(writer.CreateMessage())
        } else {
            context.ReplyUnknownMethodError()
        }
    }

    private func ReplyIntrospection(context MethodContext, path string) {
        var xml = ""
        if path == Path {
            xml = "<interface name=\"" + ChooserInterface + "\"><property name=\"version\" type=\"u\" access=\"read\"/>"
            for method in[]string{"OpenFile", "SaveFile", "SaveFiles"} {
                xml += "<method name=\"" +
                    method +
                    "\"><arg type=\"o\" direction=\"in\"/><arg type=\"s\" direction=\"in\"/><arg type=\"s\" direction=\"in\"/><arg type=\"s\" direction=\"in\"/><arg type=\"a{sv}\" direction=\"in\"/><arg type=\"u\" direction=\"out\"/><arg type=\"a{sv}\" direction=\"out\"/></method>"
            }
            xml += "</interface><interface name=\"org.freedesktop.DBus.Properties\"><method name=\"Get\"><arg type=\"s\" direction=\"in\"/><arg type=\"s\" direction=\"in\"/><arg type=\"v\" direction=\"out\"/></method><method name=\"GetAll\"><arg type=\"s\" direction=\"in\"/><arg type=\"a{sv}\" direction=\"out\"/></method></interface>"
        } else {
            lock gate {
                if !requests.ContainsKey(path) {
                    context.ReplyError("org.freedesktop.DBus.Error.UnknownObject", "Request is no longer active")
                    return
                }
            }
            xml = "<interface name=\"" + RequestInterface + "\"><method name=\"Close\"/></interface>"
        }
        context.ReplyIntrospectXml([]ReadOnlyMemory[byte]{Encoding.UTF8.GetBytes(xml)})
    }
    shared {
        internal func Run() int32 {
            try {
                using let connection = DBusConnection(
                    DBusAddress.Session ?? throw InvalidOperationException("No session D-Bus address")
                )
                connection.ConnectAsync().AsTask().GetAwaiter().GetResult()
                using let frontend = connection
                    .WatchNameOwnerAsync("org.freedesktop.portal.Desktop")
                    .GetAwaiter()
                    .GetResult()
                let portal = FileChooserPortal(frontend)
                connection.AddMethodHandler(portal)
                connection.RequestNameAsync(BusName, RequestNameOptions.None).GetAwaiter().GetResult()
                using let owners = connection
                    .AddMatchAsync[[]string](
                    MatchRule{
                        Type: MessageType.Signal,
                        Sender: "org.freedesktop.DBus",
                        Path: "/org/freedesktop/DBus",
                        Interface: "org.freedesktop.DBus",
                        Member: "NameOwnerChanged",
                    },
                    (message, _) -> {
                        let reader = message.GetBodyReader()
                        return []string{reader.ReadString(), reader.ReadString(), reader.ReadString()}
                    },
                    (error, values, _, _) -> {
                        if error != nil {
                            return
                        }
                        let frontendChanged = values[0] == "org.freedesktop.portal.Desktop" &&
                            values[1] != "" &&
                            values[1] != values[2]
                        let senderDisconnected = values[0].StartsWith(":", StringComparison.Ordinal) && values[2] == ""
                        if frontendChanged || senderDisconnected {
                            portal.CancelSender(values[1])
                        }
                    },
                    ObserverFlags.None,
                    emitOnCapturedContext: false
                )
                    .AsTask()
                    .GetAwaiter()
                    .GetResult()
                using let terminate = PosixSignalRegistration.Create(
                    PosixSignal.SIGTERM,
                    context -> {
                        context.Cancel = true
                        connection.Dispose()
                    }
                )
                using let interrupt = PosixSignalRegistration.Create(
                    PosixSignal.SIGINT,
                    context -> {
                        context.Cancel = true
                        connection.Dispose()
                    }
                )
                try {
                    let failure = connection.DisconnectedAsync().GetAwaiter().GetResult()
                    if failure != nil {
                        Console.Error.WriteLine("File chooser portal disconnected: " + failure.Message)
                        return 1
                    }
                } finally {
                    portal.Stop()
                }
                return 0
            } catch (error Exception) {
                Console.Error.WriteLine("File chooser portal failed: " + error.Message)
                return 1
            }
        }

        private func ValidateResult(request PortalChooserRequest, result PortalChooserResult) {
            if result.Response > 2 {
                throw InvalidDataException("Invalid file chooser response")
            }
            if result.Response != 0 {
                return
            }
            let count = result.Uris.Count
            if count == 0 ||
                count > 4096 ||
                (request.Method == "SaveFile" && count != 1) ||
                (request.Method == "OpenFile" && !request.Multiple && count != 1) ||
                (request.Method == "SaveFiles" && count != request.Files.Count) {
                throw InvalidDataException("Invalid file chooser selection count")
            }
            for value in result.Uris {
                let uri = Uri(value, UriKind.Absolute)
                if !uri.IsFile || (uri.Host != "" && uri.Host != "localhost") || uri.Query != "" || uri.Fragment != "" {
                    throw InvalidDataException("File chooser returned a non-local URI")
                }
            }
        }
    }
}
