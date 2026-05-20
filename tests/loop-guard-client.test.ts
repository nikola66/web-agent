import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoopGuardEnabled,
  requestLoopGuardDecision,
  shouldContinueFromLoopGuard,
  formatLoopGuardScores,
  looksLikeTaskCompleteReply,
  normalizeLoopGuardResult,
  isLoopGuardScoringUnavailable,
} from "../dist/agent-runtime/loop-guard.js";

const originalEnv = { ...process.env };

test.afterEach(() => {
  process.env = { ...originalEnv };
});

test("isLoopGuardEnabled respects WEBAGENT_LOOP_GUARD=0", () => {
  process.env.WEBAGENT_LOOP_GUARD = "0";
  assert.equal(isLoopGuardEnabled(), false);
  process.env.WEBAGENT_LOOP_GUARD = "1";
  assert.equal(isLoopGuardEnabled(), true);
});

test("requestLoopGuardDecision returns stop when disabled", async () => {
  process.env.WEBAGENT_LOOP_GUARD = "0";
  const result = await requestLoopGuardDecision(
    [{ role: "user", content: "hi" }, { role: "assistant", content: "I'll continue." }],
    { userRequest: "hi" }
  );
  assert.equal(result.decision, "stop");
  assert.equal(result.reason, "disabled");
});

test("shouldContinueFromLoopGuard", () => {
  assert.equal(shouldContinueFromLoopGuard({ decision: "continue", scores: { continue: 1, stop: 0, ask_user: 0 } }), true);
  assert.equal(shouldContinueFromLoopGuard({ decision: "stop", scores: { continue: 0, stop: 1, ask_user: 0 } }), false);
});

test("shouldContinueFromLoopGuard stops when ask_user and assistant asks a question", () => {
  const scores = { continue: 0.03, stop: 0.45, ask_user: 0.69 };
  const visible = "Pick one of these:\n1. BitNet\n2. ISO 27001\nWhat's the move?";
  assert.equal(
    shouldContinueFromLoopGuard({ decision: "ask_user", scores }, { toolsExecutedInTurn: true, visible }),
    false
  );
});

test("shouldContinueFromLoopGuard nudges ask_user when continue score is high", () => {
  const scores = { continue: 0.9, stop: 0.55, ask_user: 0.93 };
  const visible = "I'll try fetching the article again with a more surgical approach.";
  assert.equal(
    shouldContinueFromLoopGuard({ decision: "ask_user", scores }, { toolsExecutedInTurn: true, visible }),
    true
  );
});

test("shouldContinueFromLoopGuard nudges misclassified ask_user mid-task", () => {
  const scores = { continue: 0.07, stop: 0.01, ask_user: 0.85 };
  assert.equal(
    shouldContinueFromLoopGuard(
      { decision: "ask_user", scores },
      { toolsExecutedInTurn: true, visible: "I'll find the correct raw link and try again." }
    ),
    true
  );
});

test("formatLoopGuardScores renders fixed decimals", () => {
  assert.equal(
    formatLoopGuardScores({ continue: 0.5812, stop: 0.7123, ask_user: 0.1901 }),
    "continue=0.58 stop=0.71 ask_user=0.19"
  );
});

test("looksLikeTaskCompleteReply detects short final answers", () => {
  assert.equal(looksLikeTaskCompleteReply("Done. The directus skill is installed and ready to go."), true);
  assert.equal(looksLikeTaskCompleteReply("Let me try again."), false);
});

test("shouldContinueFromLoopGuard fail-open when scoring unavailable mid-turn", () => {
  const unavailable = normalizeLoopGuardResult({
    decision: "continue",
    scores: { continue: 0, stop: 0, ask_user: 0 },
    reason: "scoring_unavailable",
    error: "ONNX Runtime Web error 66250952",
  });
  assert.equal(isLoopGuardScoringUnavailable(unavailable), true);
  assert.equal(
    shouldContinueFromLoopGuard(unavailable, {
      toolsExecutedInTurn: true,
      visible: "That failed. I'll find the correct raw link first.",
    }),
    true
  );
  assert.equal(
    shouldContinueFromLoopGuard(unavailable, {
      toolsExecutedInTurn: true,
      visible: "Done. The directus skill is installed and ready to go.",
    }),
    false
  );
  assert.equal(shouldContinueFromLoopGuard(unavailable, { toolsExecutedInTurn: false }), false);
});

test("isLoopGuardScoringUnavailable detects model load failures", async () => {
  const { shouldRejectPendingToolsFromLoopGuard } = await import("../dist/agent-runtime/loop-guard.js");

  const legacyFailure = {
    decision: "stop",
    scores: { continue: 0, stop: 1, ask_user: 0 },
    reason: 'Could not locate file: "https://huggingface.co/example/onnx/model_quantized.onnx".',
  };
  assert.equal(isLoopGuardScoringUnavailable(legacyFailure), true);
  const normalized = normalizeLoopGuardResult(legacyFailure);
  assert.equal(
    shouldContinueFromLoopGuard(normalized, {
      toolsExecutedInTurn: true,
      visible: "Still working on the install.",
    }),
    true
  );
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(normalized, {
      visible: "Done.",
      pendingToolNames: ["web_search"],
    }),
    false
  );
});
