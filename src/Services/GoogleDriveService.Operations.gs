package gloop

import System
import System.Collections.Generic
import System.IO

internal partial class GoogleDriveService {
    internal func UploadPath(localPath string, parentCloudPath string, shouldCancel Func[bool]? = nil) string {
        if shouldCancel != nil && shouldCancel() {
            return "Operation cancelled."
        }

        if File.Exists(localPath) {
            return UploadFrom(localPath, parentCloudPath, Path.GetFileName(localPath), shouldCancel)
        }

        if !Directory.Exists(localPath) {
            return "Source path does not exist: " + localPath
        }

        let dirName = Path.GetFileName(localPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        let err = CreateFolderReturningId(parentCloudPath, dirName == "" ? "Folder": dirName, out var folderId)

        if err != "" {
            return err
        }

        let targetCloudPath = Locations.CloudPath(folderId)

        for subDir in Directory.GetDirectories(localPath) {
            let subErr = UploadPath(subDir, targetCloudPath, shouldCancel)

            if subErr != "" {
                return subErr
            }
        }

        for filePath in Directory.GetFiles(localPath) {
            let fileErr = UploadFrom(filePath, targetCloudPath, Path.GetFileName(filePath), shouldCancel)

            if fileErr != "" {
                return fileErr
            }
        }

        return ""
    }

    internal func DownloadPath(cloudPath string, localDestinationDir string, shouldCancel Func[bool]? = nil) string {
        if shouldCancel != nil && shouldCancel() {
            return "Operation cancelled."
        }

        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(cloudPath)
        let meta = EnsureMeta(fileId, config)
        let name = SanitizeFileName(meta != nil ? meta.Name: fileId)
        let targetIsFolder = meta != nil &&
            (meta.IsFolder || (meta.IsShortcut && meta.ShortcutTargetMimeType == "application/vnd.google-apps.folder"))

        if !targetIsFolder {
            return DownloadTo(cloudPath, Path.Combine(localDestinationDir, name), shouldCancel)
        }

        let targetDir = Path.Combine(localDestinationDir, name)
        Directory.CreateDirectory(targetDir)
        let navPath = meta != nil && meta.IsShortcut && meta.ShortcutTargetId != ""
        ? Locations.CloudPath(meta.ShortcutTargetId)
        : cloudPath

        if !ListFolder(navPath, true, out var children, out var listErr) {
            return listErr
        }

        for child in children {
            let childErr = DownloadPath(child.FullPath, targetDir, shouldCancel)

            if childErr != "" {
                return childErr
            }
        }

        return ""
    }

    internal func CopyCloudPath(sourceCloudPath string, targetParentCloudPath string) string {
        var err = ""
        let config = PrepareConfig(out err)

        if err != "" {
            return err
        }

        let fileId = Locations.CloudId(sourceCloudPath)
        let meta = EnsureMeta(fileId, config)
        let targetIsFolder = meta != nil &&
            (meta.IsFolder || (meta.IsShortcut && meta.ShortcutTargetMimeType == "application/vnd.google-apps.folder"))

        if !targetIsFolder {
            return CopyCloudToCloud(sourceCloudPath, targetParentCloudPath, "")
        }

        let folderName = meta != nil ? meta.Name: fileId
        let createErr = CreateFolderReturningId(targetParentCloudPath, folderName, out var newFolderId)

        if createErr != "" {
            return createErr
        }

        let navPath = meta != nil && meta.IsShortcut && meta.ShortcutTargetId != ""
        ? Locations.CloudPath(meta.ShortcutTargetId)
        : sourceCloudPath

        if !ListFolder(navPath, true, out var children, out var listErr) {
            return listErr
        }

        let newTargetPath = Locations.CloudPath(newFolderId)

        for child in children {
            let childErr = CopyCloudPath(child.FullPath, newTargetPath)

            if childErr != "" {
                return childErr
            }
        }

        return ""
    }
}
