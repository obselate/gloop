package gloop

import System
import System.Buffers
import System.Text

class TextContent {
    shared {
        private let Utf8 UTF8Encoding = UTF8Encoding(false, true)

        internal func HasBinaryBytes(
            buffer[]uint8,
            count int32,
            controls bool = false,
            cancelled Func[bool]? = nil
        ) bool {
            for index in 0 ... count {
                if (index & 65535) == 0 && cancelled?.Invoke() == true {
                    throw OperationCanceledException()
                }
                let value = buffer[index]
                if value == 0 || (controls && value < 32 && value != 9 && value != 10 && value != 13) {
                    return true
                }
            }
            return false
        }

        internal func IsText(buffer[]uint8, count int32, complete bool = true) bool {
            if HasBinaryBytes(buffer, count) {
                return false
            }
            var remaining = ReadOnlySpan[uint8](buffer, 0, count)
            if System.Text.Unicode.Utf8.IsValid(remaining) {
                return true
            }
            if complete {
                return false
            }
            while !remaining.IsEmpty {
                let status = Rune.DecodeFromUtf8(remaining, out var rune, out var consumed)
                if status != OperationStatus.Done {
                    return status == OperationStatus.NeedMoreData
                }
                remaining = remaining.Slice(consumed)
            }
            return true
        }

        internal func Decode(buffer[]uint8, count int32) string {
            let start = if count >= 3 && buffer[0] == 239 && buffer[1] == 187 && buffer[2] == 191 {
                3
            } else {
                0
            }
            return Utf8.GetString(buffer, start, count - start)
        }

        internal func CompleteUtf8Length(buffer[]uint8, count int32) int32 {
            if count == 0 {
                return count
            }
            var start = count - 1
            while start > 0 && (int32(buffer[start]) & 192) == 128 {
                start--
            }
            let lead = int32(buffer[start])
            let width = if lead < 128 {
                1
            } else if (lead & 224) == 192 {
                2
            } else if (lead & 240) == 224 {
                3
            } else if (lead & 248) == 240 {
                4
            } else {
                1
            }
            return start + width > count ? start: count
        }
    }
}
