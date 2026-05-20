import fs from "node:fs/promises";
import nodePath from "node:path";
import { ROOT, WORKSPACE_LABEL, WS, getWorkspaceRoot } from "./constants.js";

function workspaceRootAbs() {
  return nodePath.resolve(getWorkspaceRoot());
}

let ROOT_EQUALS_WS = true;
let WORKSPACE_SESSION_DIR = ".";
if (typeof process !== "undefined" && typeof process.cwd === "function") {
  const base = nodePath.basename(process.cwd());
  WORKSPACE_SESSION_DIR = base && base !== "/" ? base : ".";
}

export function normalizeWorkspaceRelativePath(input) {
  const raw = String(input ?? ".").trim();
  if (!raw) return ".";
  if (raw === WORKSPACE_LABEL) return ".";
  if (ROOT_EQUALS_WS) {
    if (raw === WORKSPACE_SESSION_DIR) return ".";
    let normalized = raw;
    while (normalized.startsWith(`${WORKSPACE_SESSION_DIR}/`)) {
      normalized = normalized.slice(WORKSPACE_SESSION_DIR.length + 1);
    }
    if (normalized !== raw) return normalized || ".";
  }
  if (!nodePath.isAbsolute(raw) && raw.startsWith(`${WORKSPACE_LABEL}/`)) {
    return raw.slice(WORKSPACE_LABEL.length + 1);
  }
  if (nodePath.isAbsolute(raw)) {
    const normalizedAbs = nodePath.resolve(raw);
    const rootAbs = workspaceRootAbs();
    const workspacePrefix = rootAbs + nodePath.sep;
    if (normalizedAbs === rootAbs) return ".";
    if (normalizedAbs.startsWith(workspacePrefix)) {
      return nodePath.relative(rootAbs, normalizedAbs);
    }
    const normalized = raw.replace(/\\/g, "/");
    const marker = `${WORKSPACE_LABEL}/`;
    const idx = normalized.lastIndexOf(marker);
    if (idx >= 0) {
      const sliced = normalized.slice(idx + marker.length);
      if (!ROOT_EQUALS_WS) return sliced;
      if (sliced === WORKSPACE_SESSION_DIR) return ".";
      if (sliced.startsWith(`${WORKSPACE_SESSION_DIR}/`)) {
        return sliced.slice(WORKSPACE_SESSION_DIR.length + 1) || ".";
      }
      return sliced;
    }
    return raw;
  }
  return raw.replace(/^\//, "");
}

export function withinWorkspace(rel) {
  const s = normalizeWorkspaceRelativePath(rel);
  const rootAbs = workspaceRootAbs();
  const abs = nodePath.resolve(rootAbs, s);
  if (!isWithinWorkspaceAbs(abs)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return abs;
}

export function isWithinWorkspaceAbs(absPath) {
  const rootAbs = workspaceRootAbs();
  const abs = nodePath.resolve(String(absPath || ""));
  return abs === rootAbs || abs.startsWith(rootAbs + nodePath.sep);
}

export function toWorkspaceRelative(absPath) {
  const rootAbs = workspaceRootAbs();
  const abs = nodePath.resolve(String(absPath || rootAbs));
  if (!isWithinWorkspaceAbs(abs)) {
    throw new Error(`Path escapes workspace: ${absPath}`);
  }
  return nodePath.relative(rootAbs, abs) || ".";
}

/** Top-level file basenames permitted at workspace root (identity, agent state, minimal JS/TS scaffolding). */
const ROOT_LEVEL_WRITE_ALLOWLIST = new Set([
  "AGENT.md",
  "USER.md",
  "SOUL.md",
  "HEARTBEAT.md",
  "README.md",
  "LICENSE",
  "LICENSE.md",
  "CONTRIBUTING.md",
  ".history.json",
  ".todos.json",
  ".cronjobs.json",
  ".heartbeat-state.json",
  ".channel-state.json",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".gitignore",
  ".npmrc",
  ".nvmrc",
  "tsconfig.json",
  /** Smoke / stress-test artifact at workspace root (conventional name). */
  "test_success.txt",
]);

/**
 * Blocks ad-hoc deliverables at the workspace root unless the basename is explicitly allowlisted.
 * Pass the resolved absolute file path inside the workspace. Set WEBAGENT_DISABLE_ROOT_WRITE_GUARD=1 to bypass.
 */
export function assertAllowedWorkspaceWritePath(absFilePath) {
  const bypass = String(process.env.WEBAGENT_DISABLE_ROOT_WRITE_GUARD ?? "").trim();
  if (bypass === "1" || bypass.toLowerCase() === "true") return;

  let rel = toWorkspaceRelative(absFilePath);
  rel = rel.replace(/\\/g, "/");

  if (rel === "." || rel === "") {
    throw new Error(
      'Refusing to treat the workspace root as a writable file target. Put files under a subfolder such as projects/<slug>/ or work/<slug>/ (make_dir first), or allowlist WEBAGENT_DISABLE_ROOT_WRITE_GUARD=1.'
    );
  }

  if (rel.includes("/")) return;

  const base = rel;
  if (ROOT_LEVEL_WRITE_ALLOWLIST.has(base)) return;

  throw new Error(
    `Refusing to write at workspace root (${base}). Put deliverables under projects/<slug>/ or work/<slug>/ using make_dir then write_file. Root is reserved for a small set of config files. Override: WEBAGENT_DISABLE_ROOT_WRITE_GUARD=1.`
  );
}

export function toWorkspaceDisplayPath(absPath) {
  return `${WORKSPACE_LABEL}/${toWorkspaceRelative(absPath)}`.replace(/\/\.$/, "");
}

/**
 * Context-aware path resolution. Relative paths are resolved against
 * `ctx.cwd` (when supplied and inside the workspace); the result is
 * always validated to stay within the ROOT workspace boundary.
 *
 * Falls back to `withinWorkspace(rel)` semantics for absolute paths and
 * for the common case where `ctx.cwd === ROOT` (the WebContainer
 * default), so existing tools see no behavior change.
 */
export function resolveWorkspacePath(ctx, rel) {
  const cwd = ctx?.cwd;
  const raw = String(rel ?? ".").trim();
  const rootAbs = workspaceRootAbs();
  const cwdResolved = cwd ? nodePath.resolve(String(cwd)) : "";
  if (!cwd || cwdResolved === rootAbs || cwd === ROOT || cwd === WS) return withinWorkspace(rel);

  if (nodePath.isAbsolute(raw) || raw === WORKSPACE_LABEL || raw.startsWith(`${WORKSPACE_LABEL}/`)) {
    return withinWorkspace(rel);
  }

  const baseAbs = nodePath.resolve(cwd);
  if (!isWithinWorkspaceAbs(baseAbs)) {
    return withinWorkspace(rel);
  }
  const abs = nodePath.resolve(baseAbs, raw);
  if (!isWithinWorkspaceAbs(abs)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return abs;
}

export async function ensureParentDir(abs) {
  const dir = nodePath.dirname(abs);
  const rootAbs = workspaceRootAbs();
  if (nodePath.resolve(dir) === rootAbs) {
    await fs.mkdir(rootAbs, { recursive: true });
    return;
  }
  if (dir === WS) return;
  await fs.mkdir(dir, { recursive: true });
}

export const DEFAULT_IGNORED_DIRS = new Set([
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

export function shouldSkipDir(name, ignoredDirs = DEFAULT_IGNORED_DIRS) {
  return ignoredDirs.has(String(name || ""));
}

export function globMatch(name, pattern) {
  const esc = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`).test(name);
}

export function shellCwd(cwd) {
  const c = String(cwd ?? WORKSPACE_LABEL).trim();
  if (c === "." || c === WS || c === WORKSPACE_LABEL) return WS;
  if (c.startsWith(`${WORKSPACE_LABEL}/`)) return withinWorkspace(c);
  return withinWorkspace(c);
}
