package gloop

import System
import System.IO
import System.Text.Json

internal class PortalChooserCodec {
    shared {
        internal func ReadRequest(path string) PortalChooserRequest {
            using let document = Read(path)
            let request = PortalChooserRequest()
            for property in document.RootElement.EnumerateObject() {
                let value = property.Value
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
                    for item in value.EnumerateArray() {
                        request.Files.Add(item.GetString() ?? "")
                    }
                } else if property.Name == "filters" {
                    for item in value.EnumerateArray() {
                        request.Filters.Add(ReadFilter(item))
                    }
                } else if property.Name == "currentFilter" {
                    if value.ValueKind != JsonValueKind.Null {
                        request.CurrentFilter = ReadFilter(value)
                    }
                } else if property.Name == "choices" {
                    for item in value.EnumerateArray() {
                        let choice = PortalChoice{
                            Id: item.GetProperty("id").GetString() ?? "",
                            Label: item.GetProperty("label").GetString() ?? "",
                            Selected: item.GetProperty("selected").GetString() ?? "",
                        }
                        for option in item.GetProperty("options").EnumerateArray() {
                            choice.Options.Add(
                                PortalChoiceOption{
                                    Id: option.GetProperty("id").GetString() ?? "",
                                    Label: option.GetProperty("label").GetString() ?? "",
                                }
                            )
                        }
                        request.Choices.Add(choice)
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
            let result = PortalChooserResult()
            for property in document.RootElement.EnumerateObject() {
                let value = property.Value
                if property.Name == "response" {
                    result.Response = value.GetUInt32()
                } else if property.Name == "uris" {
                    for item in value.EnumerateArray() {
                        result.Uris.Add(item.GetString() ?? "")
                    }
                } else if property.Name == "currentFilter" {
                    if value.ValueKind != JsonValueKind.Null {
                        result.CurrentFilter = ReadFilter(value)
                    }
                } else if property.Name == "choices" {
                    for item in value.EnumerateArray() {
                        result.Choices.Add(
                            PortalChoiceResult{
                                Id: item.GetProperty("id").GetString() ?? "",
                                Value: item.GetProperty("value").GetString() ?? "",
                            }
                        )
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
            if FileInfo(path).Length > 1048576 {
                throw InvalidDataException("File chooser message exceeds 1 MiB")
            }
            return JsonDocument.Parse(File.ReadAllText(path))
        }

        private func ReadFilter(value JsonElement) PortalFilter {
            let filter = PortalFilter{Name: value.GetProperty("name").GetString() ?? ""}
            for item in value.GetProperty("patterns").EnumerateArray() {
                filter.Patterns.Add(
                    PortalFilterPattern{
                        Type: item.GetProperty("type").GetUInt32(),
                        Value: item.GetProperty("value").GetString() ?? "",
                    }
                )
            }
            return filter
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
