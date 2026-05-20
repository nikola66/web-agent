/**
 * Filesystem tools — barrel re-exports from sub-modules.
 */

// Path utilities
export {
  DEFAULT_IGNORED_DIRS,
  shouldSkipDir,
  globMatch,
  resolveWorkspacePath,
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
  toWorkspaceRelative,
  normalizeWorkspaceRelativePath,
} from "../workspace-paths.js";

// Path hints for error messages
export {
  buildMissingPathHint,
  withPathHints,
} from "./filesystem/path-hints.js";

// File reading
export {
  readFileTool,
} from "./filesystem/read.js";

// File writing and editing
export {
  writeFileTool,
  editFileTool,
  multiEditTool,
  applyPatchTool,
} from "./filesystem/write.js";

// Directory listing and search
export {
  listDirTool,
  findFilesTool,
} from "./filesystem/list.js";

// File search and tree
export {
  grepTool,
  treeTool,
} from "./filesystem/search.js";

// Shell and file management
export {
  makeDirTool,
  deleteFileTool,
  moveFileTool,
  runShellTool,
} from "./filesystem/shell.js";
