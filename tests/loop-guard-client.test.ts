import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoopGuardEnabled,
  requestLoopGuardDecision,
  shouldContinueFromLoopGuard,
  formatLoopGuardScores,
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

test("formatLoopGuardScores renders fixed decimals", () => {
  assert.equal(
    formatLoopGuardScores({ continue: 0.5812, stop: 0.7123, ask_user: 0.1901 }),
    "continue=0.58 stop=0.71 ask_user=0.19"
  );
});

test("isLoopGuardScoringUnavailable detects model load failures", async () => {
  const { isLoopGuardScoringUnavailable, normalizeLoopGuardResult, shouldRejectPendingToolsFromLoopGuard, shouldContinueFromLoopGuard } =
    await import("../dist/agent-runtime/loop-guard.js");

  const legacyFailure = {
    decision: "stop",
    scores: { continue: 0, stop: 1, ask_user: 0 },
    reason: 'Could not locate file: "https://huggingface.co/example/onnx/model_quantized.onnx".',
  };
  assert.equal(isLoopGuardScoringUnavailable(legacyFailure), true);
  assert.equal(shouldContinueFromLoopGuard(normalizeLoopGuardResult(legacyFailure)), false);
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(normalizeLoopGuardResult(legacyFailure), {
      visible: "Done.",
      pendingToolNames: ["web_search"],
    }),
    false
  );
});
