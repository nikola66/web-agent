import type { TurnJudgeAction, TurnJudgeRequest, TurnJudgeResponse } from "./types.js";
import { runClassifier } from "./onnx-classifier.js";

function lastAssistantVisible(input: TurnJudgeRequest): string {
  const row = [...input.messages].reverse().find((m) => m.role === "assistant");
  return String(row?.content ?? "");
}

const MODEL_TRUST_FLOOR = 0.42;

function assistantAsksUser(visible: string): boolean {
  const t = String(visible || "").trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  if (
    t.includes("?") &&
    /\b(which|what|where|when|how|give me|would you|could you|do you want|let me know|are we)\b/i.test(t)
  ) {
    return true;
  }
  return /\b(give me the topic|which (specific )?thread|what (topic|thread)|would you like me to)\b/i.test(t);
}

function hardSafetyDecision(input: TurnJudgeRequest): TurnJudgeResponse | null {
  if (input.runtimeState.textOnly) {
    return {
      action: "stop",
      confidence: 1,
      reason: "text_only_mode",
      source: "safety",
      latencyMs: 0,
    };
  }
  if (input.runtimeState.round >= input.runtimeState.maxRounds) {
    return {
      action: "stop",
      confidence: 1,
      reason: "max_rounds_reached",
      source: "safety",
      latencyMs: 0,
    };
  }
  if (input.runtimeState.autoContinueNudges >= input.runtimeState.maxAutoContinueNudges) {
    return {
      action: "stop",
      confidence: 1,
      reason: "auto_continue_cap_reached",
      source: "safety",
      latencyMs: 0,
    };
  }
  if (
    input.runtimeState.suppressTopicPivot &&
    !input.toolState.executedToolsInTurn
  ) {
    return {
      action: "stop",
      confidence: 1,
      reason: "topic_pivot",
      source: "safety",
      latencyMs: 0,
    };
  }
  const visible = lastAssistantVisible(input);
  if (assistantAsksUser(visible)) {
    return {
      action: "stop",
      confidence: 1,
      reason: "assistant_question",
      source: "safety",
      latencyMs: 0,
    };
  }
  return null;
}

function serializeJudgeInput(input: TurnJudgeRequest): string {
  const lastMessages = input.messages.slice(-3);
  return [
    "TASK: Decide whether Web Agent should continue, stop, or ask the user.",
    "",
    "MESSAGES:",
    ...lastMessages.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 1500)}`),
    "",
    "TOOL_STATE:",
    JSON.stringify(input.toolState),
    "",
    "RUNTIME_STATE:",
    JSON.stringify(input.runtimeState),
  ].join("\n");
}

function looksLikeMidTaskContinuation(visible: string): boolean {
  const t = String(visible || "").trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return false;
  const lower = t.toLowerCase();
  if (
    /\b(done|completed|all set|here are (your )?options|which one|would you like|let me know|your call)\b/.test(
      lower
    )
  ) {
    return false;
  }
  return /\b(i('| a)?m (creating|drafting|going to|about to)|now,? i|next,? i|i'll |let me |i am creating|i am drafting)\b/i.test(
    t
  );
}

function conservativeFallback(input: TurnJudgeRequest, reason: string): Omit<TurnJudgeResponse, "latencyMs"> {
  const lastAssistant = lastAssistantVisible(input);

  if (input.toolState.executedToolsInTurn && lastAssistant.trim().length === 0) {
    return {
      action: "continue",
      confidence: 0.51,
      reason: "empty_after_tool_use",
      source: "fallback",
    };
  }

  if (
    input.toolState.executedToolsInTurn &&
    looksLikeMidTaskContinuation(lastAssistant)
  ) {
    return {
      action: "continue",
      confidence: 0.52,
      reason: `${reason}|mid_task_continuation`,
      source: "fallback",
    };
  }

  return {
    action: "stop",
    confidence: 0.5,
    reason,
    source: "fallback",
  };
}

export async function judgeTurn(input: TurnJudgeRequest): Promise<Omit<TurnJudgeResponse, "latencyMs">> {
  const safety = hardSafetyDecision(input);
  if (safety) {
    return {
      action: safety.action,
      confidence: safety.confidence,
      reason: safety.reason,
      source: safety.source,
    };
  }

  const text = serializeJudgeInput(input);
  const raw = await runClassifier(text);

  if (raw.reason === "classifier_unavailable" || raw.reason === "tokenize_failed") {
    return conservativeFallback(input, raw.reason);
  }

  if (raw.confidence >= MODEL_TRUST_FLOOR) {
    return {
      action: raw.action,
      confidence: raw.confidence,
      reason: raw.reason,
      source: "model",
    };
  }

  return conservativeFallback(input, `${raw.reason}|below_trust_floor`);
}
