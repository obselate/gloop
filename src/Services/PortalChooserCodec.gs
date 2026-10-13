package gloop

import System
import System.IO
import System.Text.Json

internal class PortalChooserCodec {
    private const MessageByteLimit int64 = 1048576

    shared {
        internal func ReadRequest(path string) PortalChooserRequest {
            using let document = Read(path)
            RequireKind(document.RootElement, JsonValueKind.Object, "Portal request", "root")
            let request = PortalChooserRequest()
            for property in document.RootElement.EnumerateObject() {
                let value = property.Value
                let kind = switch property.Name {
                    case "modal" or "multiple" or "directory": JsonValueKind.True
                    case "files" or "filters" or "choices": JsonValueKind.Array
                    case "currentFilter": JsonValueKind.Object
                    case "method" or "appId" or "parentWindow" or "title" or "acceptLabel"
                    or "currentFolder" or "currentFile" or "currentName": JsonValueKind.String
                    default: JsonValueKind.Undefined
                }
                if kind != JsonValueKind.Undefined &&
                    !(
                    value.ValueKind == JsonValueKind.Null
                    && (kind == JsonValueKind.String || property.Name == "currentFilter")
                ) {
                    RequireKind(value, kind, "Portal request", property.Name)
                }
                if property.Name == "method" {
                    request.Method = value.GetString() ?? "OpenFile"
                } else if property.Name == "appId" {
                    request.AppId = value.GetString() ?? ""
                } else if property.Name == "parentWindow" {
                    request.ParentWindow = value.GetString() ?? ""
                } else if property.Name == "title" {
                    request.Title = value.GetString() ?? ""
                } else if property.Name == "acceptLabel" {
                    request.AcceptLabel = value.GetString() ?? ""
                } else if property.Name == "modal" {
                    request.Modal = value.GetBoolean()
                } else if property.Name == "multiple" {
                    request.Multiple = value.GetBoolean()
                } else if property.Name == "directory" {
                    request.Directory = value.GetBoolean()
                } else if property.Name == "currentFolder" {
                    request.CurrentFolder = value.GetString() ?? ""
                } else if property.Name == "currentFile" {
                    request.CurrentFile = value.GetString() ?? ""
                } else if property.Name == "currentName" {
                    request.CurrentName = value.GetString() ?? ""
                } else if property.Name == "files" {
                    var index = 0
                    for item in value.EnumerateArray() {
                        RequireKind(item, JsonValueKind.String, "Portal request", "files[" + index.ToString() + "]")
                        request.Files.Add(item.GetString() ?? "")
                        index++
                    }
                } else if property.Name == "filters" {
                    var index = 0
                    for item in value.EnumerateArray() {
                        request.Filters.Add(ReadFilter(item, "Portal request", "filters[" + index.ToString() + "]"))
                        index++
                    }
                } else if property.Name == "currentFilter" {
                    if value.ValueKind != JsonValueKind.Null {
                        request.CurrentFilter = ReadFilter(value, "Portal request", property.Name)
                    }
                } else if property.Name == "choices" {
                    var index = 0
                    for item in value.EnumerateArray() {
                        let field = "choices[" + index.ToString() + "]"
                        RequireKind(item, JsonValueKind.Object, "Portal request", field)
                        let choice = PortalChoice{
                            Id: ReadField(item, "id", JsonValueKind.String, "Portal request", field).GetString() ?? "",
                            Label: ReadField(
                                item,
                                "label",
                                JsonValueKind.String,
                                "Portal request",
                                field
                            ).GetString() ?? "",
                            Selected: ReadField(
                                item,
                                "selected",
                                JsonValueKind.String,
                                "Portal request",
                                field
                            ).GetString() ?? "",
                        }
                        var optionIndex = 0
                        for option in ReadField(item, "options", JsonValueKind.Array, "Portal request", field)
                            .EnumerateArray() {
                            let optionField = field + ".options[" + optionIndex.ToString() + "]"
                            RequireKind(option, JsonValueKind.Object, "Portal request", optionField)
                            choice.Options.Add(
                                PortalChoiceOption{
                                    Id: ReadField(
                                        option,
                                        "id",
                                        JsonValueKind.String,
                                        "Portal request",
                                        optionField
                                    ).GetString() ?? "",
                                    Label: ReadField(
                                        option,
                                        "label",
                                        JsonValueKind.String,
                                        "Portal request",
                                        optionField
                                    ).GetString() ?? "",
                                }
                            )
                            optionIndex++
                        }
                        request.Choices.Add(choice)
                        index++
                    }
                }
            }
            return request
        }

        internal func WriteRequest(path string, request PortalChooserRequest) {
            using let stream = File.Create(path)
            using let writer = Utf8JsonWriter(stream)
            writer.WriteStartObject()
            writer.WriteString("method", request.Method)
            writer.WriteString("appId", request.AppId)
            writer.WriteString("parentWindow", request.ParentWindow)
            writer.WriteString("title", request.Title)
            writer.WriteString("acceptLabel", request.AcceptLabel)
            writer.WriteBoolean("modal", request.Modal)
            writer.WriteBoolean("multiple", request.Multiple)
            writer.WriteBoolean("directory", request.Directory)
            writer.WriteString("currentFolder", request.CurrentFolder)
            writer.WriteString("currentFile", request.CurrentFile)
            writer.WriteString("currentName", request.CurrentName)
            writer.WriteStartArray("files")
            for name in request.Files {
                writer.WriteStringValue(name)
            }
            writer.WriteEndArray()
            writer.WriteStartArray("filters")
            for filter in request.Filters {
                WriteFilter(writer, filter)
            }
            writer.WriteEndArray()
            writer.WritePropertyName("currentFilter")
            if let filter = request.CurrentFilter {
                WriteFilter(writer, filter)
            } else {
                writer.WriteNullValue()
            }
            writer.WriteStartArray("choices")
            for choice in request.Choices {
                writer.WriteStartObject()
                writer.WriteString("id", choice.Id)
                writer.WriteString("label", choice.Label)
                writer.WriteString("selected", choice.Selected)
                writer.WriteStartArray("options")
                for option in choice.Options {
                    writer.WriteStartObject()
                    writer.WriteString("id", option.Id)
                    writer.WriteString("label", option.Label)
                    writer.WriteEndObject()
                }
                writer.WriteEndArray()
                writer.WriteEndObject()
            }
            writer.WriteEndArray()
            writer.WriteEndObject()
        }

        internal func ReadResult(path string) PortalChooserResult {
            using let document = Read(path)
            RequireKind(document.RootElement, JsonValueKind.Object, "Portal result", "root")
            let result = PortalChooserResult()
            for property in document.RootElement.EnumerateObject() {
                let value = property.Value
                if property.Name == "response" {
                    result.Response = ReadUInt32(value, "Portal result", property.Name)
                } else if property.Name == "uris" {
                    RequireKind(value, JsonValueKind.Array, "Portal result", property.Name)
                    var index = 0
                    for item in value.EnumerateArray() {
                        RequireKind(item, JsonValueKind.String, "Portal result", "uris[" + index.ToString() + "]")
                        result.Uris.Add(item.GetString() ?? "")
                        index++
                    }
                } else if property.Name == "currentFilter" {
                    if value.ValueKind != JsonValueKind.Null {
                        result.CurrentFilter = ReadFilter(value, "Portal result", property.Name)
                    }
                } else if property.Name == "choices" {
                    RequireKind(value, JsonValueKind.Array, "Portal result", property.Name)
                    var index = 0
                    for item in value.EnumerateArray() {
                        let field = "choices[" + index.ToString() + "]"
                        RequireKind(item, JsonValueKind.Object, "Portal result", field)
                        result.Choices.Add(
                            PortalChoiceResult{
                                Id: ReadField(
                                    item,
                                    "id",
                                    JsonValueKind.String,
                                    "Portal result",
                                    field
                                ).GetString() ?? "",
                                Value: ReadField(
                                    item,
                                    "value",
                                    JsonValueKind.String,
                                    "Portal result",
                                    field
                                ).GetString() ?? "",
                            }
                        )
                        index++
                    }
                }
            }
            return result
        }

        internal func WriteResult(path string, result PortalChooserResult) {
            using let stream = File.Create(path)
            using let writer = Utf8JsonWriter(stream)
            writer.WriteStartObject()
            writer.WriteNumber("response", result.Response)
            writer.WriteStartArray("uris")
            for uri in result.Uris {
                writer.WriteStringValue(uri)
            }
            writer.WriteEndArray()
            writer.WritePropertyName("currentFilter")
            if let filter = result.CurrentFilter {
                WriteFilter(writer, filter)
            } else {
                writer.WriteNullValue()
            }
            writer.WriteStartArray("choices")
            for choice in result.Choices {
                writer.WriteStartObject()
                writer.WriteString("id", choice.Id)
                writer.WriteString("value", choice.Value)
                writer.WriteEndObject()
            }
            writer.WriteEndArray()
            writer.WriteEndObject()
        }

        private func Read(path string) JsonDocument {
            if FileInfo(path).Length > MessageByteLimit {
                throw InvalidDataException(
                    "File chooser message exceeds " + (MessageByteLimit / FileSystemService.BytesPerMiB).ToString() +
                        " MiB"
                )
            }
            return JsonDocument.Parse(File.ReadAllText(path))
        }

        private func ReadFilter(value JsonElement, format string, field string) PortalFilter {
            RequireKind(value, JsonValueKind.Object, format, field)
            let filter = PortalFilter{
                Name: ReadField(value, "name", JsonValueKind.String, format, field).GetString() ?? "",
            }
            var index = 0
            for item in ReadField(value, "patterns", JsonValueKind.Array, format, field).EnumerateArray() {
                let patternField = field + ".patterns[" + index.ToString() + "]"
                RequireKind(item, JsonValueKind.Object, format, patternField)
                filter.Patterns.Add(
                    PortalFilterPattern{
                        Type: ReadUInt32(
                            ReadField(item, "type", JsonValueKind.Number, format, patternField),
                            format,
                            patternField + ".type"
                        ),
                        Value: ReadField(item, "value", JsonValueKind.String, format, patternField).GetString() ?? "",
                    }
                )
                index++
            }
            return filter
        }

        private func ReadField(
            value JsonElement,
            name string,
            kind JsonValueKind,
            format string,
            field string
        ) JsonElement {
            var property JsonElement
            if !value.TryGetProperty(name, out property) {
                throw InvalidDataException(format + ": field " + field + "." + name + " is required")
            }
            RequireKind(property, kind, format, field + "." + name)
            return property
        }

        private func RequireKind(value JsonElement, kind JsonValueKind, format string, field string) {
            if value.ValueKind == kind || (kind == JsonValueKind.True && value.ValueKind == JsonValueKind.False) {
                return
            }
            let typeName = kind == JsonValueKind.True ? "boolean": kind.ToString().ToLowerInvariant()
            let article = kind == JsonValueKind.Array || kind == JsonValueKind.Object ? "an ": "a "
            throw InvalidDataException(format + ": field " + field + " must be " + article + typeName)
        }

        private func ReadUInt32(value JsonElement, format string, field string) uint32 {
            RequireKind(value, JsonValueKind.Number, format, field)
            var number uint32
            if !value.TryGetUInt32(out number) {
                throw InvalidDataException(format + ": field " + field + " must be an unsigned 32-bit integer")
            }
            return number
        }

        private func WriteFilter(writer Utf8JsonWriter, filter PortalFilter) {
            writer.WriteStartObject()
            writer.WriteString("name", filter.Name)
            writer.WriteStartArray("patterns")
            for pattern in filter.Patterns {
                writer.WriteStartObject()
                writer.WriteNumber("type", pattern.Type)
                writer.WriteString("value", pattern.Value)
                writer.WriteEndObject()
            }
            writer.WriteEndArray()
            writer.WriteEndObject()
        }
    }
}
