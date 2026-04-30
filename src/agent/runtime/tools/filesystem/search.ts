/**
 * File search and tree tools.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../workspace-paths.js";
import { shouldSkipDir } from "./path-utils.js";

export async function grepTool(
  { pattern, root = ".", regex = false, maxResults = 200, maxFilesScanned = 5000 } = {},
  ctx
) {
  const needle = String(pattern ?? "").trim();
  if (!needle) throw new Error("`pattern` is required for grep.");
  const base = resolveWorkspacePath(ctx, root);
  const safeMaxResults = Math.max(1, Math.min(2000, Number(maxResults) || 200));
  const safeMaxFilesScanned = Math.max(100, Math.min(20000, Number(maxFilesScanned) || 5000));
  const hits = [];
  let scanned = 0;
  const matcher = regex ? new RegExp(needle) : null;
  async function walk(d) {
    if (hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents) {
      if (hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned) return;
      const p = nodePath.join(d, e.name);
      if (e.isDirectory()) {
        if (shouldSkipDir(e.name)) continue;
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
        const lines = txt.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (hits.length >= safeMaxResults) return;
          const ok = matcher ? matcher.test(line) : line.includes(needle);
          if (ok) {
            hits.push({
              file: toWorkspaceRelative(p),
              line: idx + 1,
              text: line.slice(0, 400),
            });
          }
        });
      }
    }
  }
  try {
    await walk(base);
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${root}. Confirm path via list_dir before retrying.`);
    }
    throw err;
  }
  return {
    hits,
    scanned,
    truncated: hits.length >= safeMaxResults || scanned >= safeMaxFilesScanned,
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
  const abs = resolveWorkspacePath(ctx, rel);
  const lines = [];
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
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`Path not found: ${rel}. Confirm path via list_dir before retrying.`);
    }
    throw err;
  }
  return {
    tree: lines.join("\n"),
    scanned,
    truncated: lines.length >= safeMaxEntries || scanned >= safeMaxEntriesScanned,
  };
}
