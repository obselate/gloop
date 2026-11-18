package gloop

import System
import System.Formats.Tar
import System.IO
import System.IO.Compression
import System.Text

partial class ArchiveService {
    shared {
        internal func ReadListingPreview(path string, cancelled Func[bool]) PreviewData {
            let text = StringBuilder()
            var count = 0
            var limited = false
            try {
                using let input = File.OpenRead(path)
                if path.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) {
                    using let bounded = PreviewReadStream(input, 262144, cancelled, true)
                    using let archive = ZipArchive(bounded, ZipArchiveMode.Read, true)
                    for entry in archive.Entries {
                        if cancelled() {
                            throw OperationCanceledException()
                        }
                        if count == 512 || text.Length >= 64000 {
                            limited = true
                            break
                        }
                        AppendListingPreview(text, entry.FullName, entry.Length)
                        count++
                    }
                } else {
                    using let compressed = PreviewReadStream(input, 8388608, cancelled)
                    using let source Stream = path.EndsWith(".tar", StringComparison.OrdinalIgnoreCase)
                    ? compressed: GZipStream(compressed, CompressionMode.Decompress, true)
                    using let bounded = PreviewReadStream(source, 4194304, cancelled)
                    using let data = MemoryStream()
                    let buffer = [16384]uint8{}
                    try {
                        while true {
                            let read = bounded.Read(buffer, 0, buffer.Length)
                            if read == 0 {
                                break
                            }
                            data.Write(buffer, 0, read)
                        }
                    } catch (failure PreviewLimitException) {
                        limited = true
                    }
                    let bytes = data.GetBuffer()
                    var offset = 0
                    while offset + 512 <= int32(data.Length) {
                        if cancelled() {
                            throw OperationCanceledException()
                        }
                        let kind = bytes[offset + 156]
                        let size = ReadTarPreviewOctal(bytes, offset + 124, 12)
                        if size < 0 {
                            throw InvalidDataException("TAR preview requires octal entry sizes.")
                        }
                        if size > data.Length - offset - 512 {
                            if !limited {
                                throw InvalidDataException("TAR entry is incomplete.")
                            }
                            if kind == 120 || kind == 103 || kind == 76 || kind == 75 {
                                data.SetLength(offset)
                            }
                            break
                        }
                        offset += 512 + int32((size + 511) / 512) * 512
                    }
                    data.Position = 0
                    using let reader = TarReader(data, true)
                    try {
                        while let entry = reader.GetNextEntry() {
                            if cancelled() {
                                throw OperationCanceledException()
                            }
                            AppendListingPreview(text, entry.Name, entry.Length)
                            count++
                            if count == 512 || text.Length >= 64000 {
                                limited = true
                                break
                            }
                        }
                    } catch (failure Exception) when limited &&
                        (failure is EndOfStreamException || failure is ArgumentOutOfRangeException) { }
                }
                return PreviewData{
                    Kind: PreviewKind.Text,
                    Path: path,
                    Text: count == 0 ? (
                        limited ? "No entries fit within preview limits.": "Archive is empty."
                    ): text.ToString(),
                    Warning: limited ? "Archive listing truncated at preview limits (512 entries, 64K characters, 4 MiB decoded TAR). Names are limited to 256 characters. Sizes are in bytes.": "Names are limited to 256 characters. Sizes are in bytes.",
                }
            } catch (failure OperationCanceledException) {
                return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
            } catch (failure PreviewLimitException) {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: "Archive listing exceeds ZIP preview read or seek limits."
                }
            } catch (failure Exception) when failure is IOException ||
                failure is InvalidDataException ||
                failure is UnauthorizedAccessException ||
                failure is ArgumentException ||
                failure is NotSupportedException ||
                failure is OverflowException ||
                failure is FormatException ||
                failure is InvalidOperationException {
                return PreviewData{
                    Kind: PreviewKind.Error,
                    Path: path,
                    Error: (
                        limited ? "Archive listing stopped at the 4 MiB decoded TAR limit: ": "Archive preview failed: "
                    ) +
                        failure.Message
                }
            }
        }

        private func ReadTarPreviewOctal(bytes[]uint8, start int32, length int32) int64 {
            var value int64 = 0
            for index in start ... (start + length) {
                let digit = bytes[index]
                if digit == 0 || digit == 32 {
                    continue
                }
                if digit < 48 || digit > 55 {
                    return -1
                }
                value = value * 8 + int64(digit - 48)
            }
            return value
        }

        private func AppendListingPreview(text StringBuilder, name string, size int64) {
            text.Append(size).Append("\t")
            for index in 0 ... Math.Min(name.Length, 256) {
                let character = name[index]
                text.Append(char.IsControl(character) ? ' ': character)
            }
            if name.Length > 256 {
                text.Append("...")
            }
            text.AppendLine()
        }
    }
}
