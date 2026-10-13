package gloop

import System.IO

class FileKinds {
    shared {
        internal const DirectoryMime string = "inode/directory"

        internal func IsImage(extension string, icon bool = false) bool -> switch extension {
            case ".png" or ".jpg" or ".jpeg" or ".gif": true
            case ".webp" or ".svg": icon
            default: false
        }

        internal func IsText(extension string) bool -> switch extension {
            case "" or ".txt" or ".md" or ".log" or ".json" or ".yaml" or ".yml"
            or ".toml" or ".xml" or ".html" or ".css" or ".js" or ".ts"
            or ".gs" or ".cs" or ".sh" or ".py" or ".rs" or ".go": true
            default: false
        }

        internal func EntryKind(extension string, directory bool = false, symlink bool = false) string ->
        symlink ? "Link": directory ? "Folder": extension.Length > 1 ? extension.Substring(1).ToUpperInvariant() +
            " file": "File"

        internal func IconName(entry FileEntry) string {
            if entry.IsDirectory {
                return "folder"
            }

            let extension = Path.GetExtension(entry.Name).ToLowerInvariant()

            if IsImage(extension, true) {
                return "image"
            }

            return switch extension {
                case ".zip" or ".gz" or ".tgz" or ".tar" or ".7z" or ".xz": "folder_zip"
                case ".mp3" or ".flac" or ".wav" or ".ogg": "audio_file"
                case ".mp4" or ".mkv" or ".webm": "video_file"
                case ".gs" or ".cs" or ".rs" or ".go" or ".js" or ".ts" or ".py" or ".sh" or ".json": "code"
                default: "draft"
            }
        }
    }
}
