package gloop

import Goo.Svg
import System
import System.IO

class SvgPreview {
    private const ByteLimit int64 = 16777216

    shared {
        internal func Read(path string, cancelled Func[bool]) PreviewData {
            try {
                if cancelled() {
                    return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                }

                using let file = FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)

                if file.Length > ByteLimit {
                    return PreviewData{
                        Kind: PreviewKind.Error,
                        Path: path,
                        Error: "SVG exceeds the 16 MiB preview limit."
                    }
                }

                let vector = Svg.Load(file)

                if cancelled() {
                    return PreviewData{Kind: PreviewKind.Cancelled, Path: path}
                }

                return PreviewData{Kind: PreviewKind.Vector, Path: path, Vector: vector}
            } catch (failure Exception) when failure is SvgParseException ||
                failure is IOException ||
                failure is UnauthorizedAccessException ||
                failure is ArgumentException {
                return PreviewData{Kind: PreviewKind.Error, Path: path, Error: failure.Message}
            }
        }
    }
}
