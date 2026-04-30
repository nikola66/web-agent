/**
 * File reading tool.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  resolveWorkspacePath,
  normalizeWorkspaceRelativePath,
} from "../../workspace-paths.js";
import { errorMessage } from "../../utils.js";
import { toolPathStringFromArgs, withPathHints } from "./path-hints.js";

function looksLikeMemorySnapshotRelativePath(rel) {
  const raw = normalizeWorkspaceRelativePath(rel);
  return (
    raw.startsWith("memory/snapshots/") &&
    raw.endsWith(".json") &&
    !raw.includes("..")
  );
}

async function snapshotJsonPeers(absFilePath, limit = 44) {
  const parentAbs = nodePath.dirname(absFilePath);
  let names = [];
  try {
    names = await fs.readdir(parentAbs);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
}

export async function readFileTool(args = {}, ctx) {
  const rel =
    typeof args.path === "string" && args.path.trim()
      ? args.path.trim()
      : toolPathStringFromArgs(args);
  if (!rel) {
    throw new Error(
      "read_file requires `path` (string), or an alias: `filename`, `file`, `file_path`, `target`"
    );
  }

  async function innerReadFile() {
    const abs = resolveWorkspacePath(ctx, rel);
    return fs.readFile(abs, "utf8");
  }

  try {
    const content = await withPathHints(innerReadFile, ctx, rel);
    return {
      ok: true,
      path: rel,
      bytes: Buffer.byteLength(content, "utf8"),
      content,
    };
  } catch (e) {
    if (!looksLikeMemorySnapshotRelativePath(rel)) throw e;

    let peers = [];
    try {
      peers = await snapshotJsonPeers(resolveWorkspacePath(ctx, rel));
    } catch {
      peers = [];
    }

    const head = errorMessage(e);
    const recovery =
      "Stale snapshot spill: workspace history may have been compacted, the path never existed for this run id, or the path duplicates an outdated turn.\nFollow `result_ref` strings exactly from the most recent preceding \"Tool results (compact JSON)\" user message — never invent run ids.\nIf no valid result_ref matches, rerun the originating tool (`web_fetch`, etc.) instead of re-reading this path.";
    const suffix = peers.length
      ? `\nJSON files presently in memory/snapshots/: ${peers.join(", ")}`
      : `\nmemory/snapshots/ is empty — nothing left to reopen; rerun the originating tool.`;

    throw new Error(`${head}\n${recovery}${suffix}`);
  }
}
