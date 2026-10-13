package gloop

import System
import System.IO

class Locations {
    shared {
        internal const Recent string = "recent:"

        internal func DisplayName(path string, home string) string {
            if path == Recent {
                return "Recent"
            }
            var directory = path
            while directory.Length > 1 && Path.EndsInDirectorySeparator(directory) {
                directory = Path.TrimEndingDirectorySeparator(directory)
            }
            if directory == "/" {
                return "File system"
            }
            return directory == home ? "Home": Path.GetFileName(directory)
        }

        internal func Contains(directory string, path string) bool {
            let relative = Path.GetRelativePath(directory, path)
            return relative == "." || (relative != ".." && !relative.StartsWith("../") && !Path.IsPathRooted(relative))
        }

        internal func Resolve(
            path string,
            trashDirectory string,
            out fullPath string,
            out atTrashRoot bool
        ) LocationKind {
            atTrashRoot = false
            if path.Trim().Equals(Recent, StringComparison.OrdinalIgnoreCase) {
                fullPath = Recent
                return LocationKind.Recent
            }

            fullPath = Path.GetFullPath(path)
            atTrashRoot = trashDirectory != "" && fullPath == trashDirectory
            return trashDirectory != "" && Contains(trashDirectory, fullPath) ? LocationKind.Trash: LocationKind.Folder
        }
    }
}
