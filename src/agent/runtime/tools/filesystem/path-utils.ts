/**
 * Path resolution and validation utilities.
 */

import { resolveWorkspacePath, assertAllowedWorkspaceWritePath, ensureParentDir, toWorkspaceRelative, normalizeWorkspaceRelativePath } from "../../workspace-paths.js";

export {
  resolveWorkspacePath,
  assertAllowedWorkspaceWritePath,
  ensureParentDir,
  toWorkspaceRelative,
  normalizeWorkspaceRelativePath,
};

export const DEFAULT_IGNORED_DIRS = new Set<string>([
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "tmp",
  "temp",
]);

export function shouldSkipDir(name: string, ignoredDirs: Set<string> = DEFAULT_IGNORED_DIRS): boolean {
  return ignoredDirs.has(String(name || ""));
}

export function globMatch(name: string, pattern: string): boolean {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`).test(name);
}
