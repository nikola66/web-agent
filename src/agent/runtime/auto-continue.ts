/**
 * Auto-continuation logic for multi-step workflows.
 */

import { isDebugLogEnabled } from "./logging/debug-log.js";
import { dim } from "./terminal-format.js";
import {
  isExplicitSequenceCompletion,
  extractExactResponseTokens,
  isSchedulingAutomationIntent,
  shouldAutoContinueActionPlan,
  shouldAutoContinueAfterToolUse,
  shouldAutoContinueStrict,
  shouldAutoContinueToolSequence,
  shouldNudgeIncompleteSchedulingReply,
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

export function getAutoContinueNudgeState({
  turnInput,
  visible,
  executedToolsInTurn,
  autoContinueNudges,
  maxNudges,
  toolNames,
  originalUserInput,
  suppressActionPlanNudge,
}) {
  const exactTokens = extractExactResponseTokens(originalUserInput);
  const shouldNudgeForSequence =
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueToolSequence(turnInput, visible, toolNames);
  const shouldNudgeForAction =
    !suppressActionPlanNudge &&
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueActionPlan(turnInput, visible);
  const shouldNudgeAfterTools =
    executedToolsInTurn &&
    !isExplicitSequenceCompletion(visible) &&
    shouldAutoContinueAfterToolUse(visible);
  const shouldNudgeStrictPostTool =
    STRICT_POST_TOOL_CONTINUE &&
    executedToolsInTurn &&
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

  const want =
    shouldNudgeForSequence ||
    shouldNudgeForSchedulingAutomation ||
    shouldNudgeForAction ||
    shouldNudgeAfterTools ||
    shouldNudgeStrictPostTool ||
    shouldNudgeForMissingExact;
  let reason = "";
  if (want) {
    if (shouldNudgeForMissingExact) reason = "missing_exact_final";
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

export function emitLoopStopLine(message) {
  if (!isDebugLogEnabled()) return;
  process.stdout.write(dim(`▸ stopped: ${message}`));
}
