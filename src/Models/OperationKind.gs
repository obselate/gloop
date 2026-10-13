package gloop

import System
import System.Collections.Generic

enum OperationKind {
    CreateFolder;
    Rename;
    BulkRename;
    Copy;
    Move;
    Trash;
    Restore;
    Delete;
    Empty;
    Permissions;
    Extract;
    Compress;
}
