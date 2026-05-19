/**
 * Snapshot spill storage in files.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import {
  MEMORY_SNAPSHOTS_DIR,
  MEMORY_ROOT,
} from "../constants.js";
import {
  memoryPath,
  safeWriteJson,
} from "./sql.js";

/** Same prefix as agent/context-compaction tool-result injection (must match exactly). */
export const TOOL_RESULTS_COMPACT_PREFIX = "Tool results (compact JSON):\n";

/** Max chars to inline when unwrapping read_file(memory/snapshots/*.json) to avoid spill ping-pong. */
export const SNAPSHOT_READ_UNWRAP_MAX_CHARS = 56_000;

/** Extra room for JSON.stringify keys/quotes/escapes around unwrapped snapshot `content`. */
export const SNAPSHOT_FROM_SNAPSHOT_INLINE_SLACK = 24_576;

/**
 * Strip `result_ref` from compact tool-result lines when the spill file is gone (e.g. wiped disk,
 * pre-fix cleanup, or new workspace). Stops the model from chasing ghost paths after a failed fetch.
 */
async function rewriteCompactToolResultsWithoutMissingRefs(content, snapshotsAbsDirOverride = null) {
  const prefix = TOOL_RESULTS_COMPACT_PREFIX;
  if (typeof content !== "string" || !content.startsWith(prefix)) return content;
  const jsonPart = content.slice(prefix.length).trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonPart);
  } catch {
    return content;
  }
  if (!Array.isArray(parsed)) return content;

  let absDir;
  if (snapshotsAbsDirOverride) {
    absDir = snapshotsAbsDirOverride;
  } else {
    try {
      absDir = memoryPath(MEMORY_SNAPSHOTS_DIR);
    } catch {
      return content;
    }
  }

  let changed = false;
  const next = await Promise.all(
    parsed.map(async (item) => {
      if (!item || typeof item !== "object") return item;
      const ref = item.result_ref;
      if (typeof ref !== "string" || !ref.includes("memory/snapshots/")) return item;
      const base = ref.split("/").filter(Boolean).pop();
      if (!base || !base.endsWith(".json")) return item;
      const abs = nodePath.join(absDir, base);
      try {
        await fs.access(abs);
        return item;
      } catch {
        changed = true;
        const rest = { ...item };
        delete rest.result_ref;
        const stamp =
          "[stale result_ref removed: file missing — do not read_file this path; refetch with web_fetch or use latest tool output]";
        rest.summary =
          typeof rest.summary === "string" ? `${rest.summary} ${stamp}` : stamp;
        return rest;
      }
    })
  );
  if (!changed) return content;
  return prefix + JSON.stringify(next, null, 2);
}

/**
 * Rewrite chat messages so tool-result JSON never points at missing snapshot files.
 * @param {{ snapshotsAbsDirOverride?: string | null }} [options] — for tests: absolute snapshots directory
 */
export async function sanitizeMessagesMissingSnapshotRefs(messages, options = {}) {
  const snapshotsAbsDirOverride = options.snapshotsAbsDirOverride ?? null;
  /** @type {unknown[]} */
  const out = [];
  for (const message of messages || []) {
    if (!message || typeof message !== "object") {
      out.push(message);
      continue;
    }
    const role = message.role;
    const content = message.content;
    if (role === "user" && typeof content === "string" && content.startsWith(TOOL_RESULTS_COMPACT_PREFIX)) {
      /* eslint-disable-next-line no-await-in-loop */
      const nextContent = await rewriteCompactToolResultsWithoutMissingRefs(
        content,
        snapshotsAbsDirOverride
      );
      if (nextContent !== content) {
        out.push({ ...message, content: nextContent });
        continue;
      }
    }
    out.push(message);
  }
  return out;
}

/** Regex: spill JSON paths under memory/snapshots (basename captured). */
const SNAPSHOT_BASENAME_FROM_MESSAGE_RE = /memory\/snapshots\/([A-Za-z0-9_.-]+\.json)/g;

/**
 * Collect snapshot filenames still referenced in chat/tool-result messages (e.g. `result_ref`).
 * Used so we do not delete spill files that `.history.json` still points at.
 */
export function collectReferencedSnapshotBasenames(messages) {
  const keep = new Set();
  for (const message of messages || []) {
    const raw =
      typeof message?.content === "string"
        ? message.content
        : message?.content != null
          ? JSON.stringify(message.content)
          : "";
    if (!raw) continue;
    let match;
    SNAPSHOT_BASENAME_FROM_MESSAGE_RE.lastIndex = 0;
    while ((match = SNAPSHOT_BASENAME_FROM_MESSAGE_RE.exec(raw))) {
      if (match[1]) keep.add(match[1]);
    }
  }
  return keep;
}

/**
 * Minimum age since mtime before an unreferenced spill file may be deleted.
 * Defaults to 24 hours so context compaction cannot strip `result_ref` from transcripts and immediately
 * delete backing JSON still needed in subsequent turns.
 *
 * Set WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS (milliseconds); use `0` for immediate orphan GC (legacy behavior).
 */
function snapshotOrphanMinAgeMs() {
  const raw = String(process.env.WEBAGENT_SNAPSHOT_ORPHAN_MIN_AGE_MS ?? "").trim();
  if (!raw) return 86_400_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 86_400_000;
}

/**
 * Delete spill files under `memory/snapshots` that are not referenced by current history.
 * Pass an empty array to remove every snapshot JSON once orphans are eligible by age (see snapshotOrphanMinAgeMs).
 * @param {unknown[]} historyMessages
 * @param {string | null} [snapshotsDirAbsOverride] — for tests only; absolute directory to clean
 */
export async function cleanupSnapshotsNotReferenced(historyMessages, snapshotsDirAbsOverride = null) {
  const keep = collectReferencedSnapshotBasenames(historyMessages);
  const minAgeMs = snapshotOrphanMinAgeMs();
  const now = Date.now();
  let absDir;
  if (snapshotsDirAbsOverride) {
    absDir = snapshotsDirAbsOverride;
  } else {
    try {
      absDir = memoryPath(MEMORY_SNAPSHOTS_DIR);
    } catch {
      return;
    }
  }
  let entries = [];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .filter((e) => !keep.has(e.name))
      .map(async (e) => {
        const fp = nodePath.join(absDir, e.name);
        try {
          if (minAgeMs === 0) {
            await fs.unlink(fp);
            return;
          }
          const stat = await fs.stat(fp).catch(() => null);
          if (!stat?.mtimeMs || now - stat.mtimeMs < minAgeMs) return;
          await fs.unlink(fp);
        } catch {
          /* ignore */
        }
      })
  );
}

/** @deprecated Prefer `cleanupSnapshotsNotReferenced([])` — deletes every snapshot JSON. */
export async function cleanupOldSnapshots() {
  return cleanupSnapshotsNotReferenced([]);
}

function extractTextFromNestedToolResult(inner) {
  if (!inner || typeof inner !== "object") return null;
  if (typeof inner.text === "string" && inner.text.trim()) return inner.text;
  if (typeof inner.markdown === "string" && inner.markdown.trim()) return inner.markdown;
  if (typeof inner.transcript === "string" && inner.transcript.trim()) return inner.transcript;
  if (typeof inner.content === "string" && inner.content.trim()) {
    const c = inner.content;
    if (c.startsWith("{") && c.includes('"payload"')) {
      try {
        const nested = JSON.parse(c);
        const pl = nested?.payload;
        if (pl?.result) return extractTextFromNestedToolResult(pl.result);
      } catch {
        /* use raw content string */
      }
    }
    return c;
  }
  if (Array.isArray(inner.documents) && inner.documents.length) {
    const chunks = [];
    for (const doc of inner.documents) {
      const body = extractTextFromNestedToolResult(doc);
      if (body) {
        const url = typeof doc?.url === "string" && doc.url.trim() ? doc.url.trim() : null;
        chunks.push(url ? `# ${url}\n\n${body}` : body);
      } else if (doc?.error) {
        chunks.push(`[${doc?.url || "?"}] error: ${String(doc.error)}`);
      }
    }
    if (chunks.length) return chunks.join("\n\n---\n\n");
  }
  return null;
}

/**
 * Shrink read_file results for spill JSON so the model gets real page text in one hop, not nested snapshots.
 */
export function unwrapSnapshotReadFileExecutions(executions) {
  if (!Array.isArray(executions)) return executions;
  return executions.map((item) => unwrapSnapshotReadFileExecution(item));
}

function unwrapSnapshotReadFileExecution(item) {
  if (!item || typeof item !== "object" || item.error) return item;
  if (item.tool !== "read_file") return item;
  const res = item.result;
  if (!res || res.ok !== true || typeof res.content !== "string") return item;
  const p = String(res.path || "");
  if (!p.includes("memory/snapshots/") && !/snapshots\/run_/.test(p)) return item;

  let parsed;
  try {
    parsed = JSON.parse(res.content);
  } catch {
    return item;
  }
  const execPayload = parsed?.payload;
  if (!execPayload || typeof execPayload !== "object") return item;

  const extracted = extractTextFromNestedToolResult(execPayload.result);
  if (extracted == null) return item;

  let text = extracted;
  let truncated = false;
  if (text.length > SNAPSHOT_READ_UNWRAP_MAX_CHARS) {
    text = text.slice(0, SNAPSHOT_READ_UNWRAP_MAX_CHARS) + "\n...[truncated]";
    truncated = true;
  }

  return {
    ...item,
    result: {
      ok: true,
      path: p,
      from_snapshot: true,
      bytes: Buffer.byteLength(text, "utf8"),
      content: text,
      ...(truncated ? { content_truncated: true } : {}),
    },
  };
}

/** Per agent-round cap on total inlined tool-result JSON chars (`WEBAGENT_MAX_TURN_INLINE_CHARS`, default 60_000). */
export function getMaxTurnInlineChars() {
  const n = Number(process.env.WEBAGENT_MAX_TURN_INLINE_CHARS);
  if (Number.isFinite(n) && n >= 500) return Math.floor(n);
  return 60_000;
}

/** Mutable holder; one per `agentTurn` round for `saveCompressedToolResults`. */
export type TurnInlineBudgetState = { remaining: number };

export function createTurnInlineBudgetState(): TurnInlineBudgetState {
  return { remaining: getMaxTurnInlineChars() };
}

/**
 * Per-execution spill threshold for saveCompressedToolResults.
 * Unwrapped snapshot reads carry long `content`; the default inline cap would re-spill every round without a boosted budget below.
 * @param {{ tool?: string; result?: Record<string, unknown> } | null | undefined} item
 */
export function spillInlineCharBudgetForToolResultItem(item, inlineCharBudget = 10_000) {
  const capped = Math.max(200, Number(inlineCharBudget || 10_000));
  if (item?.tool === "read_file" && item?.result?.from_snapshot === true) {
    return Math.max(capped, SNAPSHOT_READ_UNWRAP_MAX_CHARS * 2 + SNAPSHOT_FROM_SNAPSHOT_INLINE_SLACK);
  }
  return capped;
}

export async function saveCompressedToolResults({
  runId,
  round,
  executions,
  inlineCharBudget = 10_000,
  turnInlineBudget = null,
}: {
  runId?: string;
  round?: number;
  executions?: Array<{
    tool?: string;
    result?: Record<string, unknown>;
    error?: unknown;
  }>;
  inlineCharBudget?: number;
  turnInlineBudget?: TurnInlineBudgetState | null;
}) {
  const budgetState =
    turnInlineBudget &&
    typeof turnInlineBudget === "object" &&
    turnInlineBudget !== null &&
    "remaining" in turnInlineBudget &&
    typeof (turnInlineBudget).remaining === "number"
      ? turnInlineBudget
      : { remaining: Number.MAX_SAFE_INTEGER };
  const refs = [];
  for (let index = 0; index < (executions || []).length; index += 1) {
    const item = executions[index];
    const itemBudget = spillInlineCharBudgetForToolResultItem(item, inlineCharBudget);
    const serialized = JSON.stringify(item?.result ?? item?.error ?? null, null, 2);
    const fitsItemCap = serialized.length <= itemBudget;
    const fromSnapshotRead =
      item?.tool === "read_file" && item?.result?.from_snapshot === true;
    const fitsTurnCap =
      fitsItemCap && (fromSnapshotRead || serialized.length <= budgetState.remaining);
    if (fitsTurnCap) {
      if (!fromSnapshotRead) budgetState.remaining -= serialized.length;
      refs.push(null);
      continue;
    }
    const snapshotName = `${String(runId || "run")}_r${String(round || 0)}_${index}.json`;
    const snapshotPath = `${MEMORY_SNAPSHOTS_DIR}/${snapshotName}`;
    await safeWriteJson(snapshotPath, {
      run_id: runId || null,
      round: round || 0,
      index,
      tool: item?.tool || null,
      created_at: new Date().toISOString(),
      payload: item,
      spilled_for_turn_budget: fitsItemCap ? true : undefined,
    });
    refs.push(snapshotPath.replace(`${MEMORY_ROOT}/`, "memory/"));
  }
  return refs;
}
