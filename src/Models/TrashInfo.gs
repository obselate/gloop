package gloop

import System
import System.Collections.Generic
import System.Globalization
import System.IO

class TrashInfo {
    shared {
        internal const Extension string = ".trashinfo"
        private const DateFormat string = "yyyy-MM-ddTHH:mm:ss"

        internal func Format(source string, deleted DateTime) string ->
        "[Trash Info]\nPath=" + Uri.EscapeDataString(source).Replace("%2F", "/") + "\nDeletionDate=" + deleted.ToString(
            DateFormat,
            CultureInfo.InvariantCulture
        ) +
            "\n"

        internal func Parse(source string, lines IEnumerable[string]) TrashItem {
            var item = TrashItem{TrashPath: source}
            var section = false

            for line in lines {
                if line.StartsWith("[", StringComparison.Ordinal) {
                    section = line == "[Trash Info]"
                } else if section && line.StartsWith("Path=", StringComparison.Ordinal) {
                    let path = Uri.UnescapeDataString(line.Substring(5))

                    if Path.IsPathRooted(path) {
                        item.OriginalPath = Path.GetFullPath(path)
                    }
                }
            }

            return item
        }
    }
}
