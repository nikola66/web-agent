/**
 * Loop Guard — runtime client (Nodebox). Scoring runs in the browser via IPC.
 */

import { isDebugLogEnabled } from "./logging/debug-log.js";
import { dim } from "./terminal-format.js";
import {
  isResearchIntent,
  MIN_RESEARCH_FETCHES,
  MIN_RESEARCH_SEARCHES,
} from "./turn-sequencing.js";

const STOP_THRESHOLD = 0.62;
const CONTINUE_THRESHOLD = 0.58;
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
    out.push({ role, content: content.slice(0, 4000) });
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
      return { ...STOP_RESULT, reason: "invalid_response" };
    }
    return result as SupervisorResult;
  } catch {
    return { ...STOP_RESULT, reason: "ipc_error" };
  }
}

export function shouldContinueFromLoopGuard(result) {
  return result?.decision === "continue";
}

export function shouldStopFromLoopGuard(result) {
  const d = result?.decision;
  return d === "stop" || d === "ask_user";
}

/** User asked for a multi-step deliverable (article, implementation, etc.), not a one-shot answer. */
export function isMultiStepDeliverableIntent(input) {
  return /\b(write|draft|blog|article|report|research|investigate|analyze|implement|build|create|compile|summarize|summarise)\b/i.test(
    String(input || "")
  );
}

/**
 * When the model attached tool calls after already running tools, only treat text as
 * "final" if stop clearly beats continue. Avoids halting research/blog tasks after one search.
 */
export function shouldRejectPendingToolsFromLoopGuard(result, ctx = {}) {
  if (!result || result.decision !== "stop") return false;

  const scores = result.scores ?? { continue: 0, stop: 0, ask_user: 0 };
  const visible = String(ctx.visible ?? "").trim();
  const pending = Array.isArray(ctx.pendingToolNames) ? ctx.pendingToolNames : [];

  if (!pending.length) return false;

  // Tool-only continuation — no prose to treat as a final answer.
  if (!visible) return false;

  if (scores.continue >= scores.stop - 0.08) return false;
  if (scores.continue >= CONTINUE_THRESHOLD) return false;
  if (scores.stop - scores.continue < 0.12) return false;
  if (scores.stop < STOP_THRESHOLD) return false;

  const userRequest = String(ctx.userRequest ?? "");
  const webSearchCount = Number(ctx.webSearchCount) || 0;
  const webFetchCount = Number(ctx.webFetchCount) || 0;

  if (isResearchIntent(userRequest)) {
    if (webSearchCount < MIN_RESEARCH_SEARCHES || webFetchCount < MIN_RESEARCH_FETCHES) {
      return false;
    }
  }

  if (isMultiStepDeliverableIntent(userRequest)) {
    if (webSearchCount < 2 || webFetchCount < 1) return false;
    if (visible.length < 120) return false;
  }

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
  process.stdout.write(dim(`▸ stopped: ${message}`));
}
