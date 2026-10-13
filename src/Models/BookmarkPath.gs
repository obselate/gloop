package gloop

import System
import System.Collections.Generic
import System.IO
import System.Text.Json

internal class BookmarkPath {
    shared {
        internal func Normalize(value string) string {
            if value == "" {
                return ""
            }
            try {
                if !Path.IsPathFullyQualified(value) {
                    return ""
                }
                return Path.TrimEndingDirectorySeparator(Path.GetFullPath(value))
            } catch (e Exception) {
                return ""
            }
        }
    }
}
