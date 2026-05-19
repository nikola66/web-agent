import test from "node:test";
import assert from "node:assert/strict";

import {
  isLoopGuardEnabledFromEnv,
  loopGuardEnvForRuntime,
  readLoopGuardThresholds,
} from "../src/agent/loop-guard-config.ts";
import { LOOP_GUARD_DEFAULTS } from "../src/agent/supervisor/thresholds.ts";

test("loopGuardEnvForRuntime enables by default", () => {
  const env = loopGuardEnvForRuntime({});
  assert.equal(env.WEBAGENT_LOOP_GUARD, "1");
  assert.equal(env.WEBAGENT_MAX_AUTO_CONTINUE_NUDGES, "20");
  assert.equal(env.WEBAGENT_RESEARCH_MAX_AUTO_CONTINUE_NUDGES, "30");
});

test("isLoopGuardEnabledFromEnv respects disable flag", () => {
  assert.equal(isLoopGuardEnabledFromEnv({ VITE_WEBAGENT_LOOP_GUARD: "0" }), false);
  assert.equal(isLoopGuardEnabledFromEnv({ VITE_WEBAGENT_LOOP_GUARD: "1" }), true);
});

test("readLoopGuardThresholds uses plan defaults", () => {
  const t = readLoopGuardThresholds({});
  assert.equal(t.maxMessages, LOOP_GUARD_DEFAULTS.maxMessages);
  assert.equal(t.stopThreshold, LOOP_GUARD_DEFAULTS.stopThreshold);
});
