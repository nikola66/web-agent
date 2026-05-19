import type { TurnJudgeRequest, TurnJudgeResponse } from "./types.js";
import { runClassifier } from "./onnx-classifier.js";
import { serializeJudgeInput } from "./serialize-judge-input.js";

export async function judgeTurn(
  input: TurnJudgeRequest
): Promise<Omit<TurnJudgeResponse, "latencyMs">> {
  const text = serializeJudgeInput(input);
  const raw = await runClassifier(text);

  if (raw.reason === "classifier_unavailable" || raw.reason === "tokenize_failed") {
    return {
      action: "stop",
      confidence: 0,
      reason: raw.reason,
      source: "error",
    };
  }

  return {
    action: raw.action,
    confidence: raw.confidence,
    reason: raw.reason,
    source: "model",
  };
}
