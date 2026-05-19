import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoopGuardEnabled,
  requestLoopGuardDecision,
  shouldContinueFromLoopGuard,
  shouldStopFromLoopGuard,
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

test("shouldContinueFromLoopGuard and shouldStopFromLoopGuard", () => {
  assert.equal(shouldContinueFromLoopGuard({ decision: "continue", scores: { continue: 1, stop: 0, ask_user: 0 } }), true);
  assert.equal(shouldStopFromLoopGuard({ decision: "stop", scores: { continue: 0, stop: 1, ask_user: 0 } }), true);
  assert.equal(shouldStopFromLoopGuard({ decision: "ask_user", scores: { continue: 0, stop: 0, ask_user: 1 } }), true);
  assert.equal(shouldContinueFromLoopGuard({ decision: "stop", scores: { continue: 0, stop: 1, ask_user: 0 } }), false);
});
