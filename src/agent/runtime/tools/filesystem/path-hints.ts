/**
 * Path hint generation for error messages.
 */

import nodePath from "node:path";
import fs from "node:fs/promises";
import {
  resolveWorkspacePath,
  toWorkspaceRelative,
} from "../../workspace-paths.js";

/**
 * First non-empty string among common path-argument keys (LLMs often send `filename` or `file`).
 */
export function toolPathStringFromArgs(args = {}) {
  if (!args || typeof args !== "object") return "";
  const keys = [
    "path",
    "file",
    "filename",
    "file_path",
    "filepath",
    "target",
    "destination",
    "dest",
  ];
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (t) return t;
    }
  }
  return "";
}

function levenshtein(a, b) {
  const aa = String(a ?? "");
  const bb = String(b ?? "");
  const m = aa.length;
  const n = bb.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

export async function buildMissingPathHint(ctx, rel) {
  try {
    const input = String(rel ?? "").trim();
    const abs = resolveWorkspacePath(ctx, input || ".");
    const parentAbs = nodePath.dirname(abs);
    const parentRel = toWorkspaceRelative(parentAbs);
    const parentEntries = await fs.readdir(parentAbs, { withFileTypes: true }).catch(() => null);
    if (!Array.isArray(parentEntries)) {
      return `Path not found: ${input}. Confirm the path via list_dir before retrying.`;
    }
    const base = nodePath.basename(abs);
    const candidates = parentEntries
      .map((entry) => entry.name)
      .filter(Boolean)
      .map((name) => ({ name, distance: levenshtein(base, name) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((x) => x.name);
    if (!candidates.length) {
      return `Path not found: ${input}. Parent directory exists (${parentRel}) but has no close matches.`;
    }
    return `Path not found: ${input}. Did you mean one of: ${candidates.join(", ")} ? (parent: ${parentRel})`;
  } catch {
    return `Path not found: ${String(rel ?? "")}. Confirm the path via list_dir before retrying.`;
  }
}

export async function withPathHints(op, ctx, rel) {
  try {
    return await op();
  } catch (err) {
    const code = err?.code;
    if (code === "ENOENT") {
      throw new Error(await buildMissingPathHint(ctx, rel));
    }
    throw err;
  }
}
