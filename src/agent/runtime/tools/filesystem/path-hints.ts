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

const FILE_EXT_RE = /\.[A-Za-z0-9]{1,12}$/;

function normalizeRelPath(rel) {
  return String(rel ?? "").trim().replace(/\\/g, "/");
}

export function looksLikeFilePath(rel) {
  const norm = normalizeRelPath(rel);
  if (!norm || norm === ".") return false;
  const base = nodePath.posix.basename(norm);
  return FILE_EXT_RE.test(base);
}

async function pathExists(ctx, rel) {
  try {
    await fs.access(resolveWorkspacePath(ctx, rel));
    return true;
  } catch {
    return false;
  }
}

async function nearestExistingAncestor(ctx, rel) {
  let cur = normalizeRelPath(rel);
  while (cur && cur !== ".") {
    cur = nodePath.posix.dirname(cur);
    if (!cur || cur === ".") break;
    if (await pathExists(ctx, cur)) return cur;
  }
  return ".";
}

function workspaceLayoutHint(input) {
  const base = nodePath.posix.basename(normalizeRelPath(input));
  const findHint = base && base !== input ? ` Or browse_workspace (action=find, pattern: "${base}"}).` : "";
  return (
    "Paths are workspace-relative (`.` = sandbox root), not the host repo. " +
    "See the Workspace & filesystem map in the system prompt (or read `.webagent/workspace-map.md`). " +
    "User skills: `.webagent/skills/<category>/<slug>/` — not `.webagent/capabilities/skills/`. " +
    "Deliverables: `projects/<slug>/` or `work/<slug>/`. Uploads: `.webagent/telegram-inbox/`. " +
    `Run browse_workspace({"action":"tree","path":"."}) before assuming paths exist.${findHint}`
  );
}

export type GrepSearchTarget = {
  absPath: string;
  relPath: string;
  isFile: boolean;
};

/** Resolve grep `root` to a directory tree or a single file (both are valid). */
export async function resolveGrepSearchTarget(ctx, browseRoot): Promise<GrepSearchTarget> {
  const input = normalizeRelPath(browseRoot) || ".";
  let stat;
  try {
    stat = await fs.stat(resolveWorkspacePath(ctx, input));
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(await buildMissingPathHint(ctx, input));
    }
    throw err;
  }
  return {
    absPath: resolveWorkspacePath(ctx, input),
    relPath: input,
    isFile: stat.isFile(),
  };
}

/** @deprecated use resolveGrepSearchTarget — kept for callers that only need ENOENT checks */
export async function assertGrepBrowseRoot(ctx, browseRoot) {
  await resolveGrepSearchTarget(ctx, browseRoot);
}

export async function buildMissingPathHint(ctx, rel) {
  try {
    const input = normalizeRelPath(rel);
    const abs = resolveWorkspacePath(ctx, input || ".");
    const parentAbs = nodePath.dirname(abs);
    const parentRel = toWorkspaceRelative(parentAbs);
    const parentExists = await pathExists(ctx, parentRel);
    if (!parentExists) {
      const anchor = await nearestExistingAncestor(ctx, input);
      const anchorHint =
        anchor === "."
          ? workspaceLayoutHint(input)
          : `Nearest existing ancestor: "${anchor}" — browse_workspace (action=list, path: "${anchor}"). ${workspaceLayoutHint(input)}`;
      return `Path not found: ${input}. ${anchorHint}`;
    }
    const parentEntries = await fs.readdir(parentAbs, { withFileTypes: true }).catch(() => null);
    if (!Array.isArray(parentEntries)) {
      return `Path not found: ${input}. ${workspaceLayoutHint(input)}`;
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
    return `Path not found: ${normalizeRelPath(rel)}. ${workspaceLayoutHint(rel)}`;
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
