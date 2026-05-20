/**
 * Loop Guard — runtime client (Nodebox). Scoring runs in the browser via IPC.
 */

import { isDebugLogEnabled } from "./logging/debug-log.js";
import { dim } from "./terminal-format.js";
import { isResearchIntent } from "./turn-sequencing.js";
import { ipcLoopGuardRequest } from "./ipc.js";

export type AgentDecision = "continue" | "stop" | "ask_user";

export type SupervisorScores = {
  continue: number;
  stop: number;
  ask_user: number;
};

export type SupervisorResult = {
  decision: AgentDecision;
  scores: SupervisorScores;
  reason?: string;
  error?: string;
};

export type LoopGuardPhase = "no_tools" | "post_tool_stale_calls";

export type LoopGuardContext = {
  userRequest?: string;
  webSearchCount?: number;
  webFetchCount?: number;
  toolsExecutedInTurn?: boolean;
  pendingToolNames?: string[];
  visible?: string;
  round?: number;
  loopPhase?: LoopGuardPhase;
  lastReplyHadToolCalls?: boolean;
  autoContinueNudges?: number;
};

type ConvRow = { role?: string; content?: unknown };
type SupervisorMessage = { role: string; content: string };

const STOP_RESULT: SupervisorResult = {
  decision: "stop",
  scores: { continue: 0, stop: 1, ask_user: 0 },
  reason: "disabled",
};

const SCORING_UNAVAILABLE_RESULT: SupervisorResult = {
  decision: "continue",
  scores: { continue: 0, stop: 0, ask_user: 0 },
  reason: "scoring_unavailable",
};

export function isLoopGuardScoringUnavailable(result: unknown): boolean {
  const row =
    result && typeof result === "object" ? (result as Partial<SupervisorResult>) : undefined;
  const reason = String(row?.reason ?? "");
  if (
    reason === "scoring_unavailable" ||
    reason === "ipc_error" ||
    reason === "invalid_response" ||
    reason.startsWith("scoring_unavailable:")
  ) {
    return true;
  }
  if (
    row?.decision === "stop" &&
    row?.scores?.stop === 1 &&
    row?.scores?.continue === 0 &&
    reason &&
    reason !== "disabled" &&
    /could not locate|failed to fetch|network|onnx|model/i.test(reason)
  ) {
    return true;
  }
  return false;
}

export function normalizeLoopGuardResult(result: unknown): SupervisorResult {
  if (!result || typeof result !== "object") return { ...SCORING_UNAVAILABLE_RESULT, reason: "invalid_response" };
  const row = result as SupervisorResult;
  if (!isLoopGuardScoringUnavailable(row)) return row;
  const detail = String(row.reason ?? "scoring_unavailable");
  const normalizedReason =
    detail === "scoring_unavailable" || detail === "ipc_error" || detail === "invalid_response"
      ? detail
      : `scoring_unavailable: ${detail}`;
  return {
    decision: "continue",
    scores: { continue: 0, stop: 0, ask_user: 0 },
    reason: normalizedReason,
    error: row.error,
  };
}

export function isLoopGuardEnabled() {
  const raw = String(
    typeof process !== "undefined" ? process.env?.WEBAGENT_LOOP_GUARD ?? "1" : "1"
  ).trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function resolveMaxAutoContinueNudges(originalUserInput: string | null | undefined): number {
  const base = (() => {
    const raw = String(
      typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AUTO_CONTINUE_NUDGES ?? "20" : "20"
    ).trim();
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
    return 20;
  })();
  if (!isResearchIntent(originalUserInput)) return base;
  const researchRaw = String(
    typeof process !== "undefined"
      ? process.env?.WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES ?? "30"
      : "30"
  ).trim();
  const researchParsed = Number(researchRaw);
  if (Number.isFinite(researchParsed)) return Math.max(base, researchParsed);
  return Math.max(base, 30);
}

/** Suppress continue nudges when the last batch hit a deterministic Nodebox shell block. */
export function shouldSuppressPostToolNudgeFromExecutions(
  executions: Array<{ error?: unknown; retryable?: boolean; error_code?: string }> | null | undefined
): boolean {
  if (!Array.isArray(executions) || executions.length === 0) return false;
  return executions.some(
    (item) =>
      item?.error &&
      item.retryable === false &&
      item.error_code === "nodebox_shell_unsupported"
  );
}

function isSyntheticLoopNudge(content: string): boolean {
  const t = content.trim();
  if (t === LOOP_GUARD_CONTINUE_NUDGE) return true;
  if (t.startsWith("[Continuing toward approved plan goal]")) return true;
  return false;
}

function convToSupervisorMessages(conv: ConvRow[] | null | undefined): SupervisorMessage[] {
  const out: SupervisorMessage[] = [];
  for (const row of conv || []) {
    if (!row || typeof row !== "object") continue;
    const role = String(row.role || "");
    if (role === "system") continue;
    const content =
      typeof row.content === "string"
        ? row.content
        : row.content != null
          ? JSON.stringify(row.content)
          : "";
    if (!content.trim() || isSyntheticLoopNudge(content)) continue;
    out.push({ role, content });
  }
  return out;
}

export async function requestLoopGuardDecision(
  conv: ConvRow[] | null | undefined,
  ctx: LoopGuardContext = {}
): Promise<SupervisorResult> {
  if (!isLoopGuardEnabled()) return { ...STOP_RESULT, reason: "disabled" };
  try {
    const messages = convToSupervisorMessages(conv);
    const result: unknown = await ipcLoopGuardRequest({
      messages,
      meta: {
        userRequest: ctx.userRequest,
        webSearchCount: ctx.webSearchCount,
        webFetchCount: ctx.webFetchCount,
        toolsExecutedInTurn: ctx.toolsExecutedInTurn,
        pendingToolCalls: ctx.pendingToolNames,
        round: ctx.round,
        loopPhase: ctx.loopPhase,
        lastReplyHadToolCalls: ctx.lastReplyHadToolCalls,
        autoContinueNudges: ctx.autoContinueNudges,
      },
    });
    if (!result || typeof result !== "object") {
      return normalizeLoopGuardResult({ ...STOP_RESULT, reason: "invalid_response" });
    }
    const row = result as Partial<SupervisorResult>;
    if (!row.decision) {
      return normalizeLoopGuardResult({ ...STOP_RESULT, reason: "invalid_response" });
    }
    return normalizeLoopGuardResult(row as SupervisorResult);
  } catch {
    return normalizeLoopGuardResult({ ...SCORING_UNAVAILABLE_RESULT, reason: "ipc_error" });
  }
}

/** Matches default VITE_WEBAGENT_LOOP_GUARD_CONTINUE_THRESHOLD (see thresholds.ts). */
const CONTINUE_SCORE_THRESHOLD = 0.58;

function isShortNonTaskPivot(userRequest: unknown): boolean {
  const t = String(userRequest ?? "").trim();
  if (!t || t.length >= 80) return false;
  if (
    /\b(execute|implement|fix|refactor|migrate|install|test|run|build|create|update|research|fetch|write|read|delete|add|remove)\b/i.test(
      t
    )
  ) {
    return false;
  }
  return true;
}

/** When ONNX/IPC scoring fails, avoid nudging after a clear final answer. */
export function looksLikeTaskCompleteReply(visible: unknown): boolean {
  const v = String(visible ?? "").trim();
  if (v.length < 16) return false;
  return /\b(?:done|complete|finished|installed|ready(?:\s+to\s+go)?|successfully)\b/i.test(v);
}

/** Assistant prose that expects a user reply — honor ask_user and do not nudge. */
export function visibleExpectsUserReply(visible: unknown): boolean {
  const v = String(visible ?? "").trim();
  if (v.length < 12) return false;
  if (/\?/.test(v)) return true;
  if (
    /\b(let me know|your choice|pick one|which (one|article|option)|what(?:'s| is) the move|you choose|prefer|or let me choose)\b/i.test(
      v
    )
  ) {
    return true;
  }
  if (/(?:^|\n)\s*\d+\.\s+\S/.test(v) && /\b(pick|choose|which|or let)\b/i.test(v)) return true;
  return false;
}

export function shouldContinueFromLoopGuard(
  result: SupervisorResult | null | undefined,
  ctx: LoopGuardContext = {}
): boolean {
  if (isLoopGuardScoringUnavailable(result)) {
    if (!ctx.toolsExecutedInTurn) return false;
    if (looksLikeTaskCompleteReply(ctx.visible)) return false;
    if (isShortNonTaskPivot(ctx.userRequest)) return false;
    return true;
  }
  if (result?.decision === "continue") return true;
  if (result?.decision === "ask_user") {
    const scores = result.scores ?? {};
    const cont = Number(scores.continue ?? 0);
    const stop = Number(scores.stop ?? 0);
    if (visibleExpectsUserReply(ctx.visible)) return false;
    if (cont >= CONTINUE_SCORE_THRESHOLD) return true;
    if (stop < 0.2 && cont < CONTINUE_SCORE_THRESHOLD) return true;
    return false;
  }
  return false;
}

/** When the model attached tool calls after prose, trust NLI stop to drop stale pending tools. */
export function shouldRejectPendingToolsFromLoopGuard(
  result: SupervisorResult | null | undefined,
  ctx: LoopGuardContext = {}
): boolean {
  if (isLoopGuardScoringUnavailable(result)) return false;
  if (!result || result.decision !== "stop") return false;

  const visible = String(ctx.visible ?? "").trim();
  const pending = Array.isArray(ctx.pendingToolNames) ? ctx.pendingToolNames : [];
  if (!pending.length || !visible) return false;
  return true;
}

export const LOOP_GUARD_CONTINUE_NUDGE =
  "Stay aligned with the user's latest request. Continue with the next concrete action (use a tool call if needed). If the task is genuinely finished, reply with one sentence stating the final answer.";

export function getSkillSelfImproveNudgeState({
  loopGuardDecision,
  executedToolsInTurn,
  usedTodoWrite,
  usedPlanningGate,
  estimatedStepsOverSix,
  skillMutatingCalled,
  autoContinueNudges,
  maxNudges,
}: {
  loopGuardDecision?: AgentDecision;
  executedToolsInTurn?: boolean;
  usedTodoWrite?: boolean;
  usedPlanningGate?: boolean;
  estimatedStepsOverSix?: boolean;
  skillMutatingCalled?: boolean;
  autoContinueNudges: number;
  maxNudges: number;
}) {
  const taskComplete = loopGuardDecision === "stop";
  const eligible =
    executedToolsInTurn &&
    !skillMutatingCalled &&
    taskComplete &&
    (usedTodoWrite || usedPlanningGate || estimatedStepsOverSix);

  const want = !!eligible;
  const underCap = autoContinueNudges < maxNudges;
  return {
    want,
    shouldNudge: want && underCap,
    underCap,
    reason: want ? "skill_self_improve" : "",
    maxNudges,
  };
}

export function emitLoopStopLine(message: string): void {
  if (!isDebugLogEnabled()) return;
  process.stdout.write(dim(`▸ stopped: ${message}\n\n`));
}

function formatLoopGuardScore(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "?";
}

export function formatLoopGuardScores(scores: Partial<SupervisorScores> | null | undefined): string {
  const s = scores ?? { continue: 0, stop: 0, ask_user: 0 };
  return `continue=${formatLoopGuardScore(s.continue)} stop=${formatLoopGuardScore(s.stop)} ask_user=${formatLoopGuardScore(s.ask_user)}`;
}

export function emitLoopGuardDecisionLine({
  round,
  phase,
  result,
  rejectPending,
  pendingTools,
  action,
}: {
  round?: number;
  phase?: string;
  result?: SupervisorResult | null;
  rejectPending?: boolean;
  pendingTools?: string[];
  action?: string;
}): void {
  if (!isDebugLogEnabled()) return;
  const unavailable = isLoopGuardScoringUnavailable(result);
  const decision = unavailable ? "unavailable" : String(result?.decision ?? "?");
  let line = `▸ loop guard · r${round ?? "?"} · ${phase} · ${decision} · ${formatLoopGuardScores(result?.scores)}`;
  if (result?.reason) line += ` · reason=${result.reason}`;
  if (result?.error) line += ` · error=${String(result.error).slice(0, 120)}`;
  if (rejectPending) line += " · reject pending tools";
  if (Array.isArray(pendingTools) && pendingTools.length) {
    line += ` · pending=[${pendingTools.join(", ")}]`;
  }
  if (action) line += ` · ${action}`;
  process.stdout.write(dim(`${line}\n`));
}
