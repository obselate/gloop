package gloop

import System
import System.IO

enum LocationKind {
    Folder;
    Recent;
    Trash;
}

class Locations {
    shared {
        internal const Recent string = "recent:"

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
            return trashDirectory != "" &&
                (atTrashRoot || fullPath.StartsWith(trashDirectory + "/", StringComparison.Ordinal)) ?
            LocationKind.Trash: LocationKind.Folder
        }
    }
}
