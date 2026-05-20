/**
 * Directory listing and file search tools.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  globMatch,
  resolveWorkspacePath,
  shouldSkipDir,
  toWorkspaceRelative,
} from "../../workspace-paths.js";

export async function listDirTool(
  {
    path: rel = ".",
    recursive = false,
    pattern,
    kind = "all",
    maxResults = 2000,
    maxEntriesScanned = 10000,
  } = {},
  ctx
) {
  const abs = resolveWorkspacePath(ctx, rel);
  const resolvedPattern = String(pattern ?? "").trim();
  const safeMaxResults = Math.max(1, Math.min(20000, Number(maxResults) || 2000));
  const safeMaxEntriesScanned = Math.max(100, Math.min(100000, Number(maxEntriesScanned) || 10000));
  const mode = String(kind || "all").toLowerCase();
  const includeFiles = mode === "all" || mode === "file" || mode === "files";
  const includeDirs = mode === "all" || mode === "dir" || mode === "dirs" || mode === "directory";
  const out = [];
  let scanned = 0;
  async function walk(d) {
    if (out.length >= safeMaxResults || scanned >= safeMaxEntriesScanned) return;
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      if (out.length >= safeMaxResults || scanned >= safeMaxEntriesScanned) return;
      const p = nodePath.join(d, e.name);
      const relP = toWorkspaceRelative(p);
      scanned += 1;
      if (e.isDirectory()) {
        if (
          includeDirs &&
          (!resolvedPattern || globMatch(e.name, resolvedPattern) || globMatch(relP, resolvedPattern))
        ) {
          out.push({ path: relP, kind: "dir" });
        }
        if (recursive && !shouldSkipDir(e.name)) await walk(p);
      } else if (
        includeFiles &&
        (!resolvedPattern || globMatch(e.name, resolvedPattern) || globMatch(relP, resolvedPattern))
      ) {
        out.push({ path: relP, kind: "file" });
      }
    }
  }
  try {
    await walk(abs);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${rel}. Confirm path via list_dir before retrying.`);
    }
    throw err;
  }
  return {
    entries: out,
    scanned,
    truncated: out.length >= safeMaxResults || scanned >= safeMaxEntriesScanned,
  };
}

export async function findFilesTool(
  {
    pattern,
    query,
    root = ".",
    path,
    maxResults = 500,
    maxFilesScanned = 5000,
  } = {},
  ctx
) {
  const resolvedPattern = String(pattern ?? query ?? "").trim();
  if (!resolvedPattern) {
    throw new Error("`pattern` is required for find_files.");
  }
  const resolvedRoot = String(path ?? root ?? ".").trim() || ".";
  const listing = await listDirTool(
    {
      path: resolvedRoot,
      recursive: true,
      pattern: resolvedPattern,
      kind: "file",
      maxResults,
      maxEntriesScanned: maxFilesScanned,
    },
    ctx
  );
  return {
    files: listing.entries.map((entry) => entry.path),
    scanned: listing.scanned,
    truncated: listing.truncated,
  };
}
