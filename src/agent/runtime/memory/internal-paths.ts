import { normalizeWorkspaceRelativePath } from "../workspace-paths.js";

export const MEMORY_SNAPSHOTS_REL = "memory/snapshots";
export const MEMORY_RUNS_REL = "memory/runs";

const RUN_ARCHIVE_RE = /^memory\/runs\/run_[^/]+\.json$/i;
const SNAPSHOT_SPILL_RE = /^memory\/snapshots\/run_[^/]+\.json$/i;

export function isMemorySnapshotSpillPath(rel: unknown): boolean {
  const raw = normalizeWorkspaceRelativePath(String(rel ?? "")).replace(/\\/g, "/");
  return raw === MEMORY_SNAPSHOTS_REL || SNAPSHOT_SPILL_RE.test(raw);
}

export function isMemoryRunArchivePath(rel: unknown): boolean {
  const raw = normalizeWorkspaceRelativePath(String(rel ?? "")).replace(/\\/g, "/").replace(/\/+$/, "");
  return raw === MEMORY_RUNS_REL || RUN_ARCHIVE_RE.test(raw);
}

export function isMemoryInternalRecoveryPath(rel: unknown): boolean {
  return isMemorySnapshotSpillPath(rel) || isMemoryRunArchivePath(rel);
}

export function shouldSkipMemoryInternalFileSearch(relPath: string): boolean {
  const raw = normalizeWorkspaceRelativePath(relPath).replace(/\\/g, "/");
  return (
    raw.startsWith(`${MEMORY_SNAPSHOTS_REL}/`) ||
    raw === MEMORY_SNAPSHOTS_REL ||
    raw.startsWith(`${MEMORY_RUNS_REL}/`) ||
    raw === MEMORY_RUNS_REL
  );
}

export function shouldSkipMemoryInternalDirWalk(name: string, relPath: string): boolean {
  if (name === "snapshots" && relPath.replace(/\\/g, "/").endsWith("memory")) return true;
  if (name === "runs" && relPath.replace(/\\/g, "/").endsWith("memory")) return true;
  return false;
}

export function memoryRunArchiveBlockedMessage(rel: string): string {
  return (
    `read_file on \`${rel}\` is blocked: \`memory/runs/\` stores agent turn logs (tool names, errors), not API payloads. ` +
    "Do not grep or read run archives to recover HTTP data. Rerun the originating tool (`web_fetch`, `web_post`, etc.) " +
    "or use `session_search` for prior conversation snippets — not raw run JSON."
  );
}

export function memoryInternalBrowseBlockedMessage(
  tool: string,
  rel: string
): string | null {
  const raw = normalizeWorkspaceRelativePath(rel).replace(/\\/g, "/");
  if (raw === MEMORY_SNAPSHOTS_REL || raw.startsWith(`${MEMORY_SNAPSHOTS_REL}/`)) {
    return (
      `${tool} on \`${rel}\` will not help recover API data. \`memory/snapshots/\` holds oversized tool-result spill files only. ` +
      "When compact tool output shows `result_ref`, call read_file once on that exact path (content is auto-unwrapped). " +
      "If missing or nested, rerun `web_fetch`/`web_post` — do not browse or grep under memory/snapshots."
    );
  }
  if (raw === MEMORY_RUNS_REL || raw.startsWith(`${MEMORY_RUNS_REL}/`)) {
    return (
      `${tool} on \`${rel}\` is blocked for data recovery. \`memory/runs/\` is internal agent history, not user/API content. ` +
      "Use `session_search` for prior chat context, or rerun the HTTP tool that originally fetched the data."
    );
  }
  return null;
}

export function shellMemorySpillBypassBlockedMessage(command: string): string | null {
  const cmd = String(command || "");
  const low = cmd.toLowerCase();
  const touchesInternal =
    /\bmemory\/(?:snapshots|runs)\b/i.test(cmd) ||
    /\bsnapshots\/run_/i.test(cmd) ||
    /\bruns\/run_/i.test(cmd);
  if (!touchesInternal) return null;

  const looksLikeRead =
    /\b(?:head|tail|cat|sed|awk|dd|less|more|wc|xxd|od|node\s+-e|readfilesync|readfile)\b/i.test(low) ||
    /\b(?:slice|substring|substr)\s*\(\s*0\s*,/i.test(cmd);
  if (!looksLikeRead) return null;

  return (
    "run_shell cannot read `memory/snapshots/` or `memory/runs/` to bypass tool-result spill limits. " +
    "Use read_file on the exact `result_ref` path once (auto-unwrapped), or rerun `web_fetch`/`web_post` for fresh API data."
  );
}
