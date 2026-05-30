/**
 * Directory listing and file search tools.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  matchPathPattern,
  resolveWorkspacePath,
  shouldSkipDir,
  toWorkspaceRelative,
} from "../../workspace-paths.js";
import {
  memoryInternalBrowseBlockedMessage,
  shouldSkipMemoryInternalDirWalk,
  shouldSkipMemoryInternalFileSearch,
} from "../../memory/internal-paths.js";
import {
  coerceFindFilesArguments,
  coerceWorkspaceBrowsePath,
} from "../argument-normalization.js";

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
  const relPath = coerceWorkspaceBrowsePath(rel);
  const browseBlock = memoryInternalBrowseBlockedMessage("list_dir", relPath);
  if (browseBlock) throw new Error(browseBlock);
  const abs = resolveWorkspacePath(ctx, relPath);
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
          (!resolvedPattern || matchPathPattern(e.name, relP, resolvedPattern))
        ) {
          out.push({ path: relP, kind: "dir" });
        }
        if (recursive && !shouldSkipDir(e.name)) {
          if (shouldSkipMemoryInternalDirWalk(e.name, relP)) continue;
          await walk(p);
        }
      } else if (
        includeFiles &&
        (!resolvedPattern || matchPathPattern(e.name, relP, resolvedPattern))
      ) {
        out.push({ path: relP, kind: "file" });
      }
    }
  }
  try {
    await walk(abs);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${relPath}. Confirm path via browse_workspace (action=list) before retrying.`);
    }
    throw err;
  }
  return {
    entries: out,
    scanned,
    truncated: out.length >= safeMaxResults || scanned >= safeMaxEntriesScanned,
  };
}

function pathMatchesPatterns(
  basename: string,
  relPath: string,
  patterns: string[],
  matchMode: "all" | "any" | "single"
): boolean {
  if (matchMode === "any") {
    return patterns.some((part) => matchPathPattern(basename, relPath, part));
  }
  return patterns.every((part) => matchPathPattern(basename, relPath, part));
}

export async function findFilesTool(rawArgs = {}, ctx) {
  const args = coerceFindFilesArguments(
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {}
  );
  const {
    root = ".",
    path,
    maxResults = 1000,
    maxFilesScanned = 15000,
  } = args;
  const resolvedPatterns = Array.isArray(args.patterns)
    ? (args.patterns as unknown[]).map((p) => String(p ?? "").trim()).filter(Boolean)
    : [];
  const matchMode = String(args.matchMode ?? "single") as "all" | "any" | "single";
  if (!resolvedPatterns.length) {
    throw new Error(
      "`pattern` (or `query` / `patterns`) is required for find_files. " +
        "Use patterns: [\"ainex\",\"outreach\"] to require all substrings, or pattern: \"*.md\" for globs."
    );
  }
  const resolvedRoot = coerceWorkspaceBrowsePath(String(path ?? root ?? "."));
  const browseBlock = memoryInternalBrowseBlockedMessage("find_files", resolvedRoot);
  if (browseBlock) throw new Error(browseBlock);
  const abs = resolveWorkspacePath(ctx, resolvedRoot);
  const safeMaxResults = Math.max(1, Math.min(20000, Number(maxResults) || 1000));
  const safeMaxFilesScanned = Math.max(100, Math.min(100000, Number(maxFilesScanned) || 15000));
  const files: string[] = [];
  let scanned = 0;

  async function walk(d: string) {
    if (files.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      if (files.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
      const p = nodePath.join(d, e.name);
      const relP = toWorkspaceRelative(p);
      scanned += 1;
      if (e.isDirectory()) {
        if (shouldSkipMemoryInternalDirWalk(e.name, relP)) continue;
        if (!shouldSkipDir(e.name)) await walk(p);
      } else if (pathMatchesPatterns(e.name, relP, resolvedPatterns, matchMode)) {
        if (shouldSkipMemoryInternalFileSearch(relP)) continue;
        files.push(relP);
      }
    }
  }

  try {
    await walk(abs);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${resolvedRoot}. Confirm path via browse_workspace (action=list) before retrying.`);
    }
    throw err;
  }

  const truncated = files.length >= safeMaxResults || scanned >= safeMaxFilesScanned;
  return {
    files,
    patterns: resolvedPatterns,
    matchMode,
    scanned,
    truncated,
    ...(files.length === 0
      ? {
          note:
            "No matches. Each pattern is a substring on the filename/path unless it contains * or ? (glob). " +
            'AND: patterns: ["ainex","outreach"]. OR: patterns: ["outreach","sequence"], matchMode: "any". ' +
            "Comma-separated AND: pattern: \"ainex,outreach\". Glob: pattern: \"*.md\".",
        }
      : {}),
  };
}
