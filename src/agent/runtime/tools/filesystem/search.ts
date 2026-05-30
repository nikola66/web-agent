/**
 * File search and tree tools.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  resolveWorkspacePath,
  shouldSkipDir,
  toWorkspaceRelative,
} from "../../workspace-paths.js";
import { coerceWorkspaceBrowsePath } from "../argument-normalization.js";
import { memoryInternalBrowseBlockedMessage, shouldSkipMemoryInternalDirWalk } from "../../memory/internal-paths.js";
import { resolveGrepSearchTarget } from "./path-hints.js";

type GrepHit = { file: string; line: number; text: string };

type GrepToolArgs = {
  pattern?: string;
  query?: string;
  root?: string;
  regex?: boolean;
  maxResults?: number;
  maxFilesScanned?: number;
};

export async function grepTool(
  {
    pattern,
    query,
    root = ".",
    regex = false,
    maxResults = 200,
    maxFilesScanned = 10000,
  }: GrepToolArgs = {},
  ctx?: unknown
) {
  const needle = String(pattern ?? query ?? "").trim();
  if (!needle) {
    throw new Error(
      "`pattern` is required for grep (not `query` — that is for session_search). Example: {\"pattern\":\"TODO|FIXME\"}."
    );
  }
  const browseRoot = coerceWorkspaceBrowsePath(root);
  const browseBlock = memoryInternalBrowseBlockedMessage("grep", browseRoot);
  if (browseBlock) throw new Error(browseBlock);
  const target = await resolveGrepSearchTarget(ctx, browseRoot);
  const targetBlock = memoryInternalBrowseBlockedMessage("grep", target.relPath);
  if (targetBlock) throw new Error(targetBlock);
  const safeMaxResults = Math.max(1, Math.min(2000, Number(maxResults) || 200));
  const safeMaxFilesScanned = Math.max(100, Math.min(20000, Number(maxFilesScanned) || 10000));
  const needleLc = needle.toLowerCase();
  const hits: GrepHit[] = [];
  let scanned = 0;
  const matcher = regex ? new RegExp(needle) : null;

  function pushLineHits(fileRel: string, txt: string) {
    const lines = txt.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (hits.length >= safeMaxResults) return;
      const ok = matcher ? matcher.test(line) : line.toLowerCase().includes(needleLc);
      if (ok) {
        hits.push({
          file: fileRel,
          line: idx + 1,
          text: line.slice(0, 400),
        });
      }
    });
  }

  if (target.isFile) {
    let txt;
    try {
      txt = await fs.readFile(target.absPath, "utf8");
    } catch {
      return { hits: [], scanned: 0, truncated: false, root: target.relPath, searchMode: "file" };
    }
    scanned = 1;
    pushLineHits(toWorkspaceRelative(target.absPath), txt);
    return {
      hits,
      scanned,
      truncated: hits.length >= safeMaxResults,
      root: target.relPath,
      searchMode: "file",
    };
  }

  const base = target.absPath;
  async function walk(d) {
    if (hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      if (hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
      const p = nodePath.join(d, e.name);
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
        if (shouldSkipMemoryInternalDirWalk(e.name, toWorkspaceRelative(p))) continue;
        await walk(p);
      }
      else {
        scanned += 1;
        let txt;
        try {
          txt = await fs.readFile(p, "utf8");
        } catch {
          continue;
        }
        pushLineHits(toWorkspaceRelative(p), txt);
      }
    }
  }
  await walk(base);
  return {
    hits,
    scanned,
    truncated: hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned,
    root: target.relPath,
    searchMode: "directory",
  };
}

export async function treeTool(
  {
    path: rel = ".",
    maxDepth = 4,
    maxEntries = 3000,
    maxEntriesScanned = 20000,
  } = {},
  ctx
) {
  const relPath = coerceWorkspaceBrowsePath(rel);
  const abs = resolveWorkspacePath(ctx, relPath);
  const lines: string[] = [];
  const safeMaxDepth = Math.max(0, Math.min(20, Number(maxDepth) || 4));
  const safeMaxEntries = Math.max(1, Math.min(20000, Number(maxEntries) || 3000));
  const safeMaxEntriesScanned = Math.max(100, Math.min(200000, Number(maxEntriesScanned) || 20000));
  let scanned = 0;
  async function walk(d, depth, prefix) {
    if (
      depth > safeMaxDepth ||
      lines.length >= safeMaxEntries ||
      scanned >= safeMaxEntriesScanned
    ) return;
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      if (lines.length >= safeMaxEntries || scanned >= safeMaxEntriesScanned) return;
      if (e.name.startsWith(".")) continue;
      const p = nodePath.join(d, e.name);
      const rp = toWorkspaceRelative(p) || e.name;
      scanned += 1;
      lines.push(`${prefix}${e.isDirectory() ? "📁 " : "📄 "}${rp}`);
      if (e.isDirectory() && !shouldSkipDir(e.name)) await walk(p, depth + 1, prefix + "  ");
    }
  }
  try {
    await walk(abs, 0, "");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "ENOENT") {
      throw new Error(`Path not found: ${relPath}. Confirm path via browse_workspace (action=list) before retrying.`);
    }
    throw err;
  }
  return {
    tree: lines.join("\n"),
    scanned,
    truncated: lines.length >= safeMaxEntries || scanned >= safeMaxEntriesScanned,
  };
}
