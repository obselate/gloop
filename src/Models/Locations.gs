package gloop

import System
import System.IO

class Locations {
    shared {
        internal const Recent string = "recent:"
        internal const GoogleDriveScheme string = "gdrive://"
        internal const GoogleDriveRoot string = "gdrive://root"
        internal const GoogleDriveTrash string = "gdrive://trash"

        internal func IsCloud(path string) bool -> path != nil && path.Trim().StartsWith(
            GoogleDriveScheme,
            StringComparison.OrdinalIgnoreCase
        )

        internal func IsCloudTrash(path string) bool -> IsCloud(path) && CloudId(path).Equals(
            "trash",
            StringComparison.OrdinalIgnoreCase
        )

        internal func CloudId(path string) string {
            if !IsCloud(path) {
                return ""
            }

            let raw = path.Trim().Substring(GoogleDriveScheme.Length).Trim('/')
            return raw == "" ? "root": raw
        }

        internal func CloudPath(id string) string {
            let clean = (id ?? "").Trim('/')
            return clean == "" ? GoogleDriveRoot: GoogleDriveScheme + clean
        }

        internal func DisplayName(path string, home string) string {
            if path == Recent {
                return "Recent"
            }

            if IsCloudTrash(path) {
                return "Drive Trash"
            }

            if IsCloud(path) {
                return "Google Drive"
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

            if IsCloud(path) {
                fullPath = CloudPath(CloudId(path))
                atTrashRoot = IsCloudTrash(fullPath)
                return LocationKind.Cloud
            }

            fullPath = Path.GetFullPath(path)
            atTrashRoot = trashDirectory != "" && fullPath == trashDirectory

            return trashDirectory != "" && Contains(trashDirectory, fullPath) ? LocationKind.Trash: LocationKind.Folder
        }
    }
}
