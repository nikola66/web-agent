/**
 * Auto-continuation logic for multi-step workflows.
 */

import { isDebugLogEnabled } from "./logging/debug-log.js";
import { dim } from "./terminal-format.js";
import {
  assistantSignalsTaskCompleteForSkillCapture,
  isExplicitSequenceCompletion,
  extractExactResponseTokens,
  isResearchIntent,
  isSchedulingAutomationIntent,
  shouldAutoContinueActionPlan,
  shouldAutoContinueAfterToolUse,
  shouldAutoContinueStrict,
  shouldAutoContinueToolSequence,
  shouldNudgeIncompleteResearchReply,
  shouldNudgeIncompleteSchedulingReply,
  MIN_RESEARCH_FETCHES,
} from "./turn-sequencing.js";

// Strict post-tool continuation: after at least one tool ran in the turn,
// observation-only text can trigger a recovery nudge even when no commitment
// phrasing was detected. Direct final answers still stop.
//
// Defaults to ON. Cap is the existing MAX_AUTO_CONTINUE_NUDGES so it can
// never run away. Set WEBAGENT_STRICT_POST_TOOL_CONTINUE=0 to disable.
const STRICT_POST_TOOL_CONTINUE = (() => {
  const raw = String(typeof process !== "undefined" ? process.env?.WEBAGENT_STRICT_POST_TOOL_CONTINUE ?? "1" : "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
})();

const FALSE_NO_HISTORY_RE =
  /\b(clean slate|starting with a clean slate|don't see (a )?plan|no (previous|prior) (tasks?|projects?|work|history)|haven't tackled|no conversation archives?)\b/i;

function hasRecallEvidenceFromExecutions(executions) {
  if (!Array.isArray(executions) || executions.length === 0) return false;
  for (const item of executions) {
    if (!item || typeof item !== "object" || item.error) continue;
    const tool = String(item.tool || "");
    const result = item.result;
    if (tool === "session_search") {
      const matches =
        result && typeof result === "object" && Array.isArray(result.matches)
          ? result.matches
          : [];
      if (matches.length > 0) return true;
      continue;
    }
    if (tool === "session_memory_list") {
      const entries =
        result && typeof result === "object" && Array.isArray(result.entries)
          ? result.entries
          : [];
      if (entries.length > 0) return true;
      continue;
    }
    if (tool === "read_file") {
      const path =
        result && typeof result === "object" && typeof result.path === "string"
          ? result.path.toLowerCase()
          : "";
      if (
        path.startsWith("memory/runs/") ||
        path.startsWith("memory/conversations/") ||
        path === ".webagent/session-memory.jsonl" ||
        path.startsWith("plans/") ||
        path.startsWith(".webagent/plans/")
      ) {
        return true;
      }
    }
  }
  return false;
}

export function resolveMaxAutoContinueNudges(originalUserInput) {
  const base = (() => {
    const raw = String(typeof process !== "undefined" ? process.env?.WEBAGENT_MAX_AUTO_CONTINUE_NUDGES ?? "" : "").trim();
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return Math.max(0, parsed);
    }
    return 20;
  })();
  if (!isResearchIntent(originalUserInput)) return base;
  const researchRaw = String(
    typeof process !== "undefined" ? process.env?.WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES ?? "" : ""
  ).trim();
  if (researchRaw) {
    const parsed = Number(researchRaw);
    if (Number.isFinite(parsed)) return Math.max(base, parsed);
  }
  return Math.max(base, 30);
}

/** Suppress post-tool auto-continue when the last batch hit a deterministic Nodebox shell block (avoids retry loops). */
export function shouldSuppressPostToolNudgeFromExecutions(executions) {
  if (!Array.isArray(executions) || executions.length === 0) return false;
  return executions.some(
    (item) =>
      item?.error &&
      item.retryable === false &&
      item.error_code === "nodebox_shell_unsupported"
  );
}

export function getAutoContinueNudgeState({
  turnInput,
  visible,
  executedToolsInTurn,
  autoContinueNudges,
  maxNudges,
  toolNames,
  originalUserInput,
  suppressActionPlanNudge,
  webSearchCount = 0,
  webFetchCount = 0,
  lastToolExecutions = [],
}) {
  const researchIntent = isResearchIntent(originalUserInput);
  const exactTokens = extractExactResponseTokens(originalUserInput);
  const shouldNudgeForSequence =
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueToolSequence(turnInput, visible, toolNames);
  const shouldNudgeForAction =
    !suppressActionPlanNudge &&
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueActionPlan(turnInput, visible);
  const suppressPostToolFromErrors = shouldSuppressPostToolNudgeFromExecutions(lastToolExecutions);
  const shouldNudgeAfterTools =
    executedToolsInTurn &&
    !suppressPostToolFromErrors &&
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueAfterToolUse(visible);
  const shouldNudgeStrictPostTool =
    STRICT_POST_TOOL_CONTINUE &&
    executedToolsInTurn &&
    !suppressPostToolFromErrors &&
    !shouldNudgeForAction &&
    !shouldNudgeAfterTools &&
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueStrict(visible);
  const shouldNudgeForMissingExact =
    exactTokens.length > 0 &&
    exactTokens.some((token) => !String(visible).includes(token)) &&
    !isExplicitSequenceCompletion(visible);
  const shouldNudgeForSchedulingAutomation =
    !executedToolsInTurn &&
    !isExplicitSequenceCompletion(visible) &&
    isSchedulingAutomationIntent(originalUserInput) &&
    shouldNudgeIncompleteSchedulingReply(visible);
  const shouldNudgeForResearch =
    researchIntent &&
    !isExplicitSequenceCompletion(visible) &&
    shouldNudgeIncompleteResearchReply(visible, {
      researchIntent: true,
      webSearchCount,
      webFetchCount,
    });
  const researchSoftBlocks =
    shouldNudgeForResearch && webFetchCount < MIN_RESEARCH_FETCHES;
  const shouldNudgeForFalseNoHistory =
    executedToolsInTurn &&
    FALSE_NO_HISTORY_RE.test(String(visible || "")) &&
    hasRecallEvidenceFromExecutions(lastToolExecutions);

  const want =
    shouldNudgeForSequence ||
    shouldNudgeForSchedulingAutomation ||
    shouldNudgeForFalseNoHistory ||
    shouldNudgeForResearch ||
    (!researchSoftBlocks && shouldNudgeForAction) ||
    shouldNudgeAfterTools ||
    shouldNudgeStrictPostTool ||
    shouldNudgeForMissingExact;
  let reason = "";
  if (want) {
    if (shouldNudgeForMissingExact) reason = "missing_exact_final";
    else if (shouldNudgeForFalseNoHistory) reason = "false_no_history";
    else if (shouldNudgeForResearch) reason = "research_incomplete";
    else if (shouldNudgeForSchedulingAutomation) reason = "scheduling_automation";
    else if (shouldNudgeForAction) reason = "action_plan";
    else if (shouldNudgeAfterTools) reason = "post_tool_commitment";
    else if (shouldNudgeStrictPostTool) reason = "post_tool_strict";
    else reason = "tool_sequence";
  }
  const underCap = autoContinueNudges < maxNudges;
  return {
    want,
    shouldNudge: want && underCap,
    underCap,
    reason,
    maxNudges,
  };
}

/** One-shot Hermes-style skill capture after todo/plan/long runs — avoids silent skill churn. */
export function getSkillSelfImproveNudgeState({
  visible,
  executedToolsInTurn,
  usedTodoWrite,
  usedPlanningGate,
  estimatedStepsOverSix,
  skillMutatingCalled,
  autoContinueNudges,
  maxNudges,
}) {
  const eligible =
    executedToolsInTurn &&
    !skillMutatingCalled &&
    (usedTodoWrite || usedPlanningGate || estimatedStepsOverSix) &&
    assistantSignalsTaskCompleteForSkillCapture(visible);

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
