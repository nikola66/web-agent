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
};

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

export function isLoopGuardScoringUnavailable(result) {
  const reason = String(result?.reason ?? "");
  if (
    reason === "scoring_unavailable" ||
    reason === "ipc_error" ||
    reason === "invalid_response" ||
    reason.startsWith("scoring_unavailable:")
  ) {
    return true;
  }
  if (
    result?.decision === "stop" &&
    result?.scores?.stop === 1 &&
    result?.scores?.continue === 0 &&
    reason &&
    reason !== "disabled" &&
    /could not locate|failed to fetch|network|onnx|model/i.test(reason)
  ) {
    return true;
  }
  return false;
}

export function normalizeLoopGuardResult(result) {
  if (!result || typeof result !== "object") return { ...SCORING_UNAVAILABLE_RESULT, reason: "invalid_response" };
  if (!isLoopGuardScoringUnavailable(result)) return result as SupervisorResult;
  const detail = String(result.reason ?? "scoring_unavailable");
  const normalizedReason =
    detail === "scoring_unavailable" || detail === "ipc_error" || detail === "invalid_response"
      ? detail
      : `scoring_unavailable: ${detail}`;
  return {
    decision: "continue",
    scores: { continue: 0, stop: 0, ask_user: 0 },
    reason: normalizedReason,
    error: result.error,
  };
}

export function isLoopGuardEnabled() {
  const raw = String(
    typeof process !== "undefined" ? process.env?.WEBAGENT_LOOP_GUARD ?? "1" : "1"
  ).trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

export function resolveMaxAutoContinueNudges(originalUserInput) {
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
export function shouldSuppressPostToolNudgeFromExecutions(executions) {
  if (!Array.isArray(executions) || executions.length === 0) return false;
  return executions.some(
    (item) =>
      item?.error &&
      item.retryable === false &&
      item.error_code === "nodebox_shell_unsupported"
  );
}

function convToSupervisorMessages(conv) {
  const out = [];
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
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

export async function requestLoopGuardDecision(conv, ctx = {}) {
  if (!isLoopGuardEnabled()) return { ...STOP_RESULT, reason: "disabled" };
  try {
    const messages = convToSupervisorMessages(conv);
    const result = await ipcLoopGuardRequest({
      messages,
      meta: {
        userRequest: ctx.userRequest,
        webSearchCount: ctx.webSearchCount,
        webFetchCount: ctx.webFetchCount,
        toolsExecutedInTurn: ctx.toolsExecutedInTurn,
        pendingToolCalls: ctx.pendingToolNames,
      },
    });
    if (!result || typeof result !== "object" || !result.decision) {
      return normalizeLoopGuardResult({ ...STOP_RESULT, reason: "invalid_response" });
    }
    return normalizeLoopGuardResult(result as SupervisorResult);
  } catch {
    return normalizeLoopGuardResult({ ...SCORING_UNAVAILABLE_RESULT, reason: "ipc_error" });
  }
}

export function shouldContinueFromLoopGuard(result) {
  if (isLoopGuardScoringUnavailable(result)) return false;
  return result?.decision === "continue";
}

/** When the model attached tool calls after prose, trust NLI stop to drop stale pending tools. */
export function shouldRejectPendingToolsFromLoopGuard(result, ctx = {}) {
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

export function emitLoopStopLine(message) {
  if (!isDebugLogEnabled()) return;
  process.stdout.write(dim(`▸ stopped: ${message}\n\n`));
}

function formatLoopGuardScore(n) {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(2) : "?";
}

export function formatLoopGuardScores(scores) {
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
}) {
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
