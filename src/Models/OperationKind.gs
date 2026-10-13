package gloop

import System
import System.Collections.Generic

enum OperationKind {
    CreateFolder;
    Rename;
    Copy;
    Move;
    Trash;
    Restore;
    Delete;
    Empty;
    Permissions;
}
