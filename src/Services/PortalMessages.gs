package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text
import Tmds.DBus.Protocol

internal class PortalCall {
    internal let Context MethodContext
    internal let Request PortalChooserRequest
    internal let Handle string
    internal let Sender string
    internal var Canceled bool

    internal init(context MethodContext, request PortalChooserRequest, handle string) {
        Context = context
        Request = request
        Handle = handle
        Sender = context.Request.SenderAsString ?? ""
    }
}

internal class PortalMessages {
    shared {
        internal func Read(context MethodContext) PortalCall {
            let reader = context.Request.GetBodyReader()
            let handle = reader.ReadObjectPathAsString()
            if !handle.StartsWith("/org/freedesktop/portal/desktop/request/", StringComparison.Ordinal) {
                throw InvalidDataException("Invalid portal request path")
            }
            let request = PortalChooserRequest{
                Method: context.Request.MemberAsString ?? "OpenFile",
                AppId: reader.ReadString(),
                ParentWindow: reader.ReadString(),
                Title: reader.ReadString(),
            }
            let options = reader.ReadDictionaryStart()
            while reader.HasNext(options) {
                reader.AlignStruct()
                let key = reader.ReadString()
                let value = reader.ReadVariantValue()
                if key == "accept_label" {
                    request.AcceptLabel = value.GetString()
                } else if key == "modal" {
                    request.Modal = value.GetBool()
                } else if key == "multiple" {
                    request.Multiple = value.GetBool()
                } else if key == "directory" {
                    request.Directory = value.GetBool()
                } else if key == "current_name" {
                    request.CurrentName = value.GetString()
                } else if key == "current_folder" {
                    request.CurrentFolder = PathBytes(value)
                } else if key == "current_file" {
                    request.CurrentFile = PathBytes(value)
                } else if key == "files" {
                    Bound(value.Count, 4096)
                    for i in 0 ... value.Count {
                        request.Files.Add(PathBytes(value.GetItem(i)))
                    }
                } else if key == "filters" {
                    Bound(value.Count)
                    for i in 0 ... value.Count {
                        request.Filters.Add(ReadFilter(value.GetItem(i)))
                    }
                } else if key == "current_filter" {
                    request.CurrentFilter = ReadFilter(value)
                } else if key == "choices" {
                    Bound(value.Count)
                    for i in 0 ... value.Count {
                        let item = value.GetItem(i)
                        let choice = PortalChoice{
                            Id: item.GetItem(0).GetString(),
                            Label: item.GetItem(1).GetString(),
                            Selected: item.GetItem(3).GetString(),
                        }
                        let choices = item.GetItem(2)
                        Bound(choices.Count)
                        for j in 0 ... choices.Count {
                            let option = choices.GetItem(j)
                            choice.Options.Add(
                                PortalChoiceOption{
                                    Id: option.GetItem(0).GetString(),
                                    Label: option.GetItem(1).GetString(),
                                }
                            )
                        }
                        request.Choices.Add(choice)
                    }
                }
            }
            return PortalCall(context, request, handle)
        }

        internal func Reply(context MethodContext, result PortalChooserResult) {
            let values = Dictionary[string, VariantValue]()
            if result.Response == 0 {
                values["uris"] = VariantValue.Array(result.Uris)
                let choices = Tmds.DBus.Protocol.Array[Struct[string, string]]()
                for choice in result.Choices {
                    choices.Add(Struct.Create(choice.Id, choice.Value))
                }
                values["choices"] = choices
                if let filter = result.CurrentFilter {
                    let patterns = Tmds.DBus.Protocol.Array[Struct[uint32, string]]()
                    for pattern in filter.Patterns {
                        patterns.Add(Struct.Create(pattern.Type, pattern.Value))
                    }
                    values["current_filter"] = Struct.Create(filter.Name, patterns)
                }
            }
            using let writer = context.CreateReplyWriter("ua{sv}")
            writer.WriteUInt32(result.Response)
            writer.WriteDictionary(values)
            context.Reply(writer.CreateMessage())
        }

        private func ReadFilter(value VariantValue) PortalFilter {
            let filter = PortalFilter{Name: value.GetItem(0).GetString()}
            let patterns = value.GetItem(1)
            Bound(patterns.Count)
            for i in 0 ... patterns.Count {
                let item = patterns.GetItem(i)
                let kind = item.GetItem(0).GetUInt32()
                if kind > 1 {
                    throw InvalidDataException("Unsupported file filter type")
                }
                filter.Patterns.Add(PortalFilterPattern{Type: kind, Value: item.GetItem(1).GetString()})
            }
            return filter
        }

        private func PathBytes(value VariantValue) string {
            let bytes = value.GetArray[byte]()
            if bytes.Length > 16384 {
                throw InvalidDataException("File chooser path is too long")
            }
            var length = bytes.Length
            for i in 0 ... bytes.Length {
                if bytes[i] == 0 {
                    length = i
                    break
                }
            }
            for i in length ... bytes.Length {
                if bytes[i] != 0 {
                    throw InvalidDataException("Embedded NUL in file chooser path")
                }
            }
            return UTF8Encoding(false, true).GetString(bytes, 0, length)
        }

        private func Bound(count int32, maximum int32 = 128) {
            if count > maximum {
                throw InvalidDataException("Too many file chooser options")
            }
        }
    }
}
