import test from "node:test";
import assert from "node:assert/strict";

import {
  appendToolGuardrailGuidance,
  canonicalToolArgs,
  classifyToolFailure,
  fileMutationResultLanded,
  toolCallSignatureFromCall,
  toolGuardrailSyntheticResult,
  ToolCallGuardrailController,
  TOOL_LOOP_GUARDRAIL_DEFAULTS,
} from "../src/agent/runtime/tools/tool-loop-guardrails.ts";

test("toolCallSignature hashes canonical nested args", () => {
  const argsA = { z: [{ beta: "x", a: 1 }], a: { y: 2, x: "secret" } };
  const argsB = { a: { x: "secret", y: 2 }, z: [{ a: 1, beta: "x" }] };
  assert.equal(canonicalToolArgs(argsA), canonicalToolArgs(argsB));
  const sigA = toolCallSignatureFromCall("web_search", argsA);
  const sigB = toolCallSignatureFromCall("web_search", argsB);
  assert.equal(sigA.argsHash, sigB.argsHash);
  assert.equal(sigA.argsHash.length, 64);
});

test("default config is warn-first with hard stop disabled", () => {
  assert.equal(TOOL_LOOP_GUARDRAIL_DEFAULTS.warningsEnabled, true);
  assert.equal(TOOL_LOOP_GUARDRAIL_DEFAULTS.hardStopEnabled, false);
  assert.equal(TOOL_LOOP_GUARDRAIL_DEFAULTS.exactFailureWarnAfter, 2);
  assert.equal(TOOL_LOOP_GUARDRAIL_DEFAULTS.sameToolFailureWarnAfter, 3);
  assert.equal(TOOL_LOOP_GUARDRAIL_DEFAULTS.noProgressWarnAfter, 2);
});

test("repeated identical failed call warns without blocking by default", () => {
  const controller = new ToolCallGuardrailController();
  const args = { query: "same" };
  const decisions = [];
  for (let i = 0; i < 5; i++) {
    assert.equal(controller.beforeCall("web_search", args).action, "allow");
    decisions.push(controller.afterCall("web_search", args, '{"error":"boom"}', true));
  }
  assert.equal(decisions[0]?.action, "allow");
  assert.deepEqual(
    decisions.slice(1).map((d) => d.action),
    ["warn", "warn", "warn", "warn"]
  );
  assert.equal(controller.haltDecision, null);
});

test("hard stop blocks repeated exact failure before next execution", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    hardStopEnabled: true,
    exactFailureWarnAfter: 2,
    exactFailureBlockAfter: 2,
    sameToolFailureHaltAfter: 99,
  });
  const args = { query: "same" };
  controller.afterCall("web_search", args, '{"error":"boom"}', true);
  controller.afterCall("web_search", args, '{"error":"boom"}', true);
  const blocked = controller.beforeCall("web_search", args);
  assert.equal(blocked.action, "block");
  assert.equal(blocked.code, "repeated_exact_failure_block");
});

test("same tool varying args warns without halting by default", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    sameToolFailureWarnAfter: 2,
    sameToolFailureHaltAfter: 3,
  });
  const first = controller.afterCall("run_shell", { command: "a" }, '{"exit_code":1}', true);
  const second = controller.afterCall("run_shell", { command: "b" }, '{"exit_code":1}', true);
  const third = controller.afterCall("run_shell", { command: "c" }, '{"exit_code":1}', true);
  assert.equal(first.action, "allow");
  assert.equal(second.action, "warn");
  assert.equal(third.action, "warn");
  assert.match(second.message, /Do not switch to text-only replies/i);
  assert.equal(controller.haltDecision, null);
});

test("hard stop halts same tool varying args failure streak", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    hardStopEnabled: true,
    exactFailureBlockAfter: 99,
    sameToolFailureWarnAfter: 2,
    sameToolFailureHaltAfter: 3,
  });
  controller.afterCall("run_shell", { command: "a" }, '{"exit_code":1}', true);
  controller.afterCall("run_shell", { command: "b" }, '{"exit_code":1}', true);
  const halt = controller.afterCall("run_shell", { command: "c" }, '{"exit_code":1}', true);
  assert.equal(halt.action, "halt");
  assert.equal(halt.code, "same_tool_failure_halt");
});

test("idempotent no progress warns without blocking by default", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    noProgressWarnAfter: 2,
    noProgressBlockAfter: 2,
  });
  const args = { path: "/tmp/same.txt" };
  const result = "same file contents";
  let decision;
  for (let i = 0; i < 4; i++) {
    assert.equal(controller.beforeCall("read_file", args).action, "allow");
    decision = controller.afterCall("read_file", args, result, false);
  }
  assert.equal(decision?.action, "warn");
  assert.equal(decision?.code, "idempotent_no_progress_warning");
});

test("file mutation lint error result is not a tool failure", () => {
  const writeResult = JSON.stringify({
    bytes_written: 12,
    lint: { status: "error", output: "SyntaxError" },
  });
  assert.equal(fileMutationResultLanded("write_file", writeResult), true);
  assert.equal(classifyToolFailure("write_file", writeResult), false);
});

test("appendToolGuardrailGuidance appends warning suffix", () => {
  const guided = appendToolGuardrailGuidance("ok", {
    action: "warn",
    code: "repeated_exact_failure_warning",
    message: "change strategy",
    toolName: "web_search",
    count: 2,
  });
  assert.match(guided, /Tool loop warning/);
  assert.match(guided, /change strategy/);
});

test("toolGuardrailSyntheticResult encodes guardrail metadata", () => {
  const payload = JSON.parse(
    toolGuardrailSyntheticResult({
      action: "block",
      code: "repeated_exact_failure_block",
      message: "blocked",
      toolName: "web_search",
      count: 5,
    })
  );
  assert.equal(payload.error, "blocked");
  assert.equal(payload.guardrail.code, "repeated_exact_failure_block");
});

test("success resets exact signature failure streak", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    hardStopEnabled: true,
    exactFailureBlockAfter: 2,
    sameToolFailureHaltAfter: 99,
  });
  const args = { query: "same" };
  controller.afterCall("web_search", args, '{"error":"boom"}', true);
  controller.afterCall("web_search", args, '{"ok":true}', false);
  controller.afterCall("web_search", args, '{"error":"boom"}', true);
  assert.equal(controller.beforeCall("web_search", args).action, "allow");
});
