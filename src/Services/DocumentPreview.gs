package gloop

import System
import System.IO
import System.IO.Compression
import System.Text
import System.Xml

class DocumentPreview {
    private const CompressedByteLimit int64 = 33554432
    private const XmlByteLimit int64 = 8388608
    private const OutputCharacterLimit int32 = 262144
    private const WordNamespace string = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    private const StrictWordNamespace string = "http://purl.oclc.org/ooxml/wordprocessingml/main"
    private const OfficeNamespace string = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    private const TextNamespace string = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"

    shared {
        internal func Read(path string, cancelled Func[bool]) PreviewData {
            let output = StringBuilder()

            try {
                if cancelled() {
                    return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                }

                let extension = Path.GetExtension(path)
                let word = extension.Equals(".docx", StringComparison.OrdinalIgnoreCase)

                if !word && !extension.Equals(".odt", StringComparison.OrdinalIgnoreCase) {
                    return PreviewData{Kind: PreviewKind.Metadata, Path: path, Text: "Unsupported document format."}
                }

                using let file = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read)

                if file.Length > CompressedByteLimit {
                    return PreviewData{
                        Kind: PreviewKind.Metadata,
                        Path: path,
                        Text: "Document text preview unavailable: the file exceeds the 32 MiB compressed input limit."
                    }
                }

                using let archive = ZipArchive(file, ZipArchiveMode.Read)
                let entry = archive.GetEntry(
                    if word {
                        "word/document.xml"
                    } else {
                        "content.xml"
                    }
                )

                if cancelled() {
                    return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                }
                if entry == nil {
                    return PreviewData{
                        Kind: PreviewKind.Error,
                        Path: path,
                        Error: "Unsupported, encrypted or corrupt document: main text content is missing."
                    }
                }

                using let source = entry.Open()
                using let bounded = PreviewReadStream(source, XmlByteLimit, cancelled)
                let settings = XmlReaderSettings()
                settings.DtdProcessing = DtdProcessing.Prohibit
                settings.XmlResolver = nil
                settings.MaxCharactersInDocument = XmlByteLimit
                settings.IgnoreComments = true
                settings.IgnoreProcessingInstructions = true
                using let reader = XmlReader.Create(bounded, settings)
                let buffer = [4096]char
                var bodyDepth = -1
                var paragraphDepth = -1
                var textDepth = -1
                var foundBody = false
                var truncated = false

                while reader.Read() {
                    if cancelled() {
                        return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                    }

                    let element = reader.NodeType == XmlNodeType.Element
                    let end = reader.NodeType == XmlNodeType.EndElement
                    let wordElement = reader.NamespaceURI == WordNamespace || reader.NamespaceURI == StrictWordNamespace
                    let textElement = reader.NamespaceURI == TextNamespace

                    if element &&
                        reader.LocalName == "body" &&
                        ((word && wordElement) || (!word && reader.NamespaceURI == OfficeNamespace)) {
                        foundBody = true
                        bodyDepth = if reader.IsEmptyElement {
                            -1
                        } else {
                            reader.Depth
                        }
                    }
                    if bodyDepth < 0 {
                        continue
                    }

                    let paragraph = (word && wordElement && reader.LocalName == "p") ||
                        (!word && textElement && (reader.LocalName == "p" || reader.LocalName == "h"))

                    if element && paragraph && paragraphDepth < 0 {
                        paragraphDepth = reader.Depth
                    }
                    if element && textDepth >= 0 {
                        throw XmlException("Nested elements are not supported in document text.")
                    }
                    if element &&
                        word &&
                        wordElement &&
                        reader.LocalName == "t" &&
                        paragraphDepth >= 0 &&
                        !reader.IsEmptyElement {
                        textDepth = reader.Depth
                    }
                    if (
                        reader.NodeType == XmlNodeType.Text ||
                            reader.NodeType == XmlNodeType.CDATA ||
                            reader.NodeType == XmlNodeType.SignificantWhitespace ||
                            reader.NodeType == XmlNodeType.Whitespace
                    ) &&
                        ((word && textDepth >= 0) || (!word && paragraphDepth >= 0)) {
                        var count = reader.ReadValueChunk(buffer, 0, buffer.Length)

                        while count > 0 {
                            if cancelled() {
                                return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                            }

                            let remaining = OutputCharacterLimit - output.Length
                            var take = Math.Min(count, remaining)

                            if take < count && take > 0 && Char.IsHighSurrogate(buffer[take - 1]) {
                                take--
                            }

                            output.Append(buffer, 0, take)

                            if take < count {
                                truncated = true
                                break
                            }

                            count = reader.ReadValueChunk(buffer, 0, buffer.Length)
                        }
                    }

                    var separator = ""
                    var repeat = 1

                    if (end || (element && reader.IsEmptyElement)) && paragraph {
                        separator = "\n"
                        if reader.Depth == paragraphDepth {
                            paragraphDepth = -1
                        }
                    } else if element && paragraphDepth >= 0 {
                        if word && wordElement {
                            if reader.LocalName == "tab" {
                                separator = "\t"
                            } else if reader.LocalName == "br" || reader.LocalName == "cr" {
                                separator = "\n"
                            }
                        } else if !word && textElement {
                            if reader.LocalName == "tab" {
                                separator = "\t"
                            } else if reader.LocalName == "line-break" {
                                separator = "\n"
                            } else if reader.LocalName == "s" {
                                separator = " "
                                let attribute = reader.GetAttribute("c", TextNamespace)
                                if attribute != nil && (!int32.TryParse(attribute, out repeat) || repeat < 1) {
                                    throw XmlException("Invalid repeated space count.")
                                }
                            }
                        }
                    }
                    if separator != "" {
                        let take = Math.Min(repeat, OutputCharacterLimit - output.Length)
                        output.Append(separator[0], take)
                        truncated = truncated || take < repeat
                    }
                    if end && wordElement && reader.LocalName == "t" {
                        textDepth = -1
                    }
                    if end && reader.Depth == bodyDepth {
                        bodyDepth = -1
                    }
                    if truncated {
                        break
                    }
                }

                if !foundBody {
                    return PreviewData{
                        Kind: PreviewKind.Error,
                        Path: path,
                        Error: "Corrupt document: text body is missing."
                    }
                }

                let content = output.ToString()

                if String.IsNullOrWhiteSpace(content) {
                    return PreviewData{
                        Kind: PreviewKind.Metadata,
                        Path: path,
                        Text: if truncated {
                            "Document preview truncated before any readable text."
                        } else {
                            "Document contains no previewable text."
                        }
                    }
                }

                return PreviewData{
                    Kind: PreviewKind.Text,
                    Path: path,
                    Text: content,
                    Warning: if truncated {
                        "Text-only preview truncated at 262,144 characters. Formatting and embedded content are not shown."
                    } else {
                        "Text-only preview. Formatting and embedded content are not shown."
                    }
                }
            } catch (failure OperationCanceledException) {
                return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
            } catch (failure PreviewLimitException) {
                let content = output.ToString()

                if String.IsNullOrWhiteSpace(content) {
                    return PreviewData{
                        Kind: PreviewKind.Metadata,
                        Path: path,
                        Text: "Document preview truncated at the 8 MiB XML limit before any readable text."
                    }
                }

                return PreviewData{
                    Kind: PreviewKind.Text,
                    Path: path,
                    Text: content,
                    Warning: "Text-only preview truncated at the 8 MiB XML limit. Formatting and embedded content are not shown."
                }
            } catch (failure XmlException) {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: "Corrupt or unsafe document XML. DTDs and external references are not supported."
                }
            } catch (failure InvalidDataException) {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: "Corrupt or unsupported document archive: " + failure.Message
                }
            } catch (failure NotSupportedException) {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: "Unsupported document archive: " + failure.Message
                }
            } catch (failure Exception) when failure is IOException ||
                failure is UnauthorizedAccessException ||
                failure is ArgumentException {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: "Document preview failed: " + failure.Message
                }
            }
        }
    }
}
