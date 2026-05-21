import test from "node:test";
import assert from "node:assert/strict";

import { toolGuardrailsEnvForRuntime } from "../src/agent/tool-guardrails-config.ts";

test("toolGuardrailsEnvForRuntime mirrors VITE env keys", () => {
  const env = toolGuardrailsEnvForRuntime({
    VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS: "1",
    VITE_WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP: "0",
    VITE_WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER: "3",
  });
  assert.equal(env.WEBAGENT_TOOL_LOOP_GUARDRAILS_WARNINGS, "1");
  assert.equal(env.WEBAGENT_TOOL_LOOP_GUARDRAILS_HARD_STOP, "0");
  assert.equal(env.WEBAGENT_TOOL_LOOP_EXACT_FAILURE_WARN_AFTER, "3");
});
