/**
 * Detect stuck tool loops within a single agent turn (multi-round).
 */

import { createHash } from "node:crypto";
import { stableStringify } from "../stream-output.js";

const WARN_THRESHOLD = 3;
const HALT_THRESHOLD = 5;

export type ToolFailureStreakState = {
  /** sha1(toolName + argsStreakKey) → consecutive failures for that signature */
  failureKeyCounts: Map<string, number>;
  /** toolName → consecutive failures (any args) */
  toolFailureStreak: Map<string, number>;
};

export function createToolFailureStreakState(): ToolFailureStreakState {
  return { failureKeyCounts: new Map(), toolFailureStreak: new Map() };
}

export function compactFailureFingerprint(toolName: string, args: unknown): string {
  const h = createHash("sha1");
  h.update(String(toolName) + stableStringify(args ?? {}));
  return h.digest("hex");
}

export type GuardCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Abort before executing if we already exhausted failure budget for planned calls.
 */
export function guardBeforeToolBatch(
  state: ToolFailureStreakState,
  tools: Array<{ name: string; arguments?: unknown }>
): GuardCheckResult {
  for (const t of tools) {
    const name = String(t?.name || "").trim() || "unknown";
    const fp = compactFailureFingerprint(name, t.arguments);
    const ek = `${name}:${fp}`;
    const fk = state.failureKeyCounts.get(ek) || 0;
    const ts = state.toolFailureStreak.get(name) || 0;

    if (fk >= HALT_THRESHOLD) {
      return {
        ok: false,
        reason: `Stopping: identical ${name} call failed ${fk} consecutive times.`,
      };
    }
    if (ts >= HALT_THRESHOLD) {
      return {
        ok: false,
        reason: `Stopping: tool "${name}" failed ${ts} consecutive times.`,
      };
    }
  }
  return { ok: true };
}

/**
 * Update streak maps after executions; optionally return a console warning near thresholds.
 */
export function updateToolFailureStreakAfterResults(
  state: ToolFailureStreakState,
  tools: Array<{ name: string; arguments?: unknown }>,
  executions: Array<Record<string, unknown>>
): string | undefined {
  let warnMsg: string | undefined;

  const n = Math.min(tools.length, executions.length);
  for (let i = 0; i < n; i++) {
    const name = String(tools[i]?.name || "").trim() || "unknown";
    const args = tools[i]?.arguments;
    const fp = compactFailureFingerprint(name, args);
    const ek = `${name}:${fp}`;
    const ex = executions[i];
    const ok = ex && !ex.error;

    if (ok) {
      state.failureKeyCounts.delete(ek);
      state.toolFailureStreak.delete(name);
      continue;
    }

    state.failureKeyCounts.set(ek, (state.failureKeyCounts.get(ek) || 0) + 1);
    state.toolFailureStreak.set(name, (state.toolFailureStreak.get(name) || 0) + 1);

    const kf = state.failureKeyCounts.get(ek) || 0;
    const kt = state.toolFailureStreak.get(name) || 0;

    if (kf === WARN_THRESHOLD || kt === WARN_THRESHOLD) {
      warnMsg =
        `[tool streak] repeated failures (${name}); identical-arg streak=${kf}, tool streak=${kt}. Change approach soon.`;
    }
  }

  return warnMsg;
}
