package gloop

import System
import System.IO
import System.Text

class FileNames {
    shared {
        internal const MaxBytes int32 = 255
        private let Utf8 UTF8Encoding = UTF8Encoding(false, true)

        internal func Validate(name string) {
            if name.Trim() == "" || name == "." || name == ".." || name.Contains('/')
            || name.Contains('\0') || Utf8.GetByteCount(name) > MaxBytes {
                throw IOException("Enter a single valid file name")
            }
        }

        internal func Truncate(value string, maxBytes int32) string {
            var length = value.Length
            while length > 0 && Utf8.GetByteCount(value.AsSpan(0, length)) > maxBytes {
                length--
                if length > 0 && Char.IsHighSurrogate(value[length - 1]) {
                    length--
                }
            }
            return value.Substring(0, length)
        }
    }
}
