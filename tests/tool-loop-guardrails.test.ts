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

test("repeated identical failed call warns then halts by default", () => {
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
    ["warn", "halt", "halt", "halt"]
  );
  assert.equal(decisions[2]?.code, "doom_loop_halt");
  assert.equal(controller.haltDecision?.code, "doom_loop_halt");
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

test("same tool varying args warns without halting when hard stop off", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    hardStopEnabled: false,
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

test("read_file failure warnings include path-specific recovery guidance", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    sameToolFailureWarnAfter: 2,
  });
  controller.afterCall("read_file", { path: "a.ts" }, '{"error":"missing"}', true);
  const warned = controller.afterCall("read_file", { path: "b.ts" }, '{"error":"missing"}', true);
  assert.equal(warned.action, "warn");
  assert.match(warned.message, /list_dir|find_files/i);
});

test("run_python failure warnings steer away from urllib loops", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    sameToolFailureWarnAfter: 2,
  });
  const err = "run_python exited with code 1\nstderr:\nTypeError: 'JsProxy' object is not iterable";
  controller.afterCall("run_python", { code: "import urllib.request" }, JSON.stringify({ error: err }), true);
  const warned = controller.afterCall(
    "run_python",
    { code: "import webagent.http as http" },
    JSON.stringify({ error: err }),
    true
  );
  assert.equal(warned.action, "warn");
  assert.match(warned.message, /web_fetch|web_post/);
  assert.match(warned.message, /webagent\.http/);
  assert.match(warned.message, /urllib|pyfetch|requests/i);
});

test("grep failure warnings mention directory root requirement", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    sameToolFailureWarnAfter: 2,
  });
  controller.afterCall("grep", { pattern: "version", root: ".webagent/package.json" }, '{"error":"missing"}', true);
  const warned = controller.afterCall(
    "grep",
    { pattern: "name", root: "src/package.json" },
    '{"error":"missing"}',
    true
  );
  assert.equal(warned.action, "warn");
  assert.match(warned.message, /list_dir|find_files|workspace/i);
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

test("idempotent no progress warns without blocking when hard stop off", () => {
  const controller = new ToolCallGuardrailController({
    ...TOOL_LOOP_GUARDRAIL_DEFAULTS,
    hardStopEnabled: false,
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

test("fileMutationResultLanded accepts write_file ok and bytes shape", () => {
  const writeResult = JSON.stringify({ ok: true, path: "work/a.md", bytes: 596 });
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

test("snapshot read_file chain blocks on second memory/snapshots read", () => {
  const controller = new ToolCallGuardrailController();
  const args = { path: "memory/snapshots/run_x_r1_0.json" };
  assert.equal(controller.beforeCall("read_file", args).action, "allow");
  const blocked = controller.beforeCall("read_file", args);
  assert.equal(blocked.action, "block");
  assert.equal(blocked.code, "snapshot_read_chain_block");
  assert.match(blocked.message, /list_digest/i);
});

test("first snapshot read_file warns after success when enabled", () => {
  const controller = new ToolCallGuardrailController();
  const args = { path: "memory/snapshots/run_x_r1_0.json" };
  controller.beforeCall("read_file", args);
  const warned = controller.afterCall("read_file", args, '{"ok":true,"content":"x"}', false);
  assert.equal(warned.action, "warn");
  assert.equal(warned.code, "snapshot_read_chain_warning");
});

test("web_fetch blocks fourth identical URL after three successes in one turn", () => {
  const controller = new ToolCallGuardrailController();
  const args = { url: "https://hub.example/items" };
  const ok = '{"ok":true,"text":"data"}';
  controller.afterCall("web_fetch", args, ok, false);
  controller.afterCall("web_fetch", args, ok, false);
  controller.afterCall("web_fetch", args, ok, false);
  const blocked = controller.beforeCall("web_fetch", args);
  assert.equal(blocked.action, "block");
  assert.equal(blocked.code, "web_fetch_repeat_block");
});

test("write_file missing required fields blocks before execution", () => {
  const controller = new ToolCallGuardrailController();
  const blocked = controller.beforeCall("write_file", {});
  assert.equal(blocked.action, "block");
  assert.equal(blocked.code, "write_file_missing_required");
  assert.match(blocked.message, /path.*content/i);
});

test("repeated identical blocked calls halt as a doom loop", () => {
  const controller = new ToolCallGuardrailController();
  assert.equal(controller.beforeCall("write_file", {}).action, "block");
  assert.equal(controller.beforeCall("write_file", {}).action, "block");
  const halted = controller.beforeCall("write_file", {});
  assert.equal(halted.action, "halt");
  assert.equal(halted.code, "doom_loop_halt");
});

test("write_file repeated full overwrite blocks after second distinct rewrite", () => {
  const controller = new ToolCallGuardrailController();
  const path = "projects/blog/article.md";
  const ok = JSON.stringify({ ok: true, path, bytes: 120 });
  assert.equal(
    controller.beforeCall("write_file", { path, content: "# Title\n\nBody" }).action,
    "allow"
  );
  controller.afterCall("write_file", { path, content: "# Title\n\nBody" }, ok, false);
  assert.equal(
    controller.beforeCall("write_file", { path, content: "# New Title\n\nRewritten" }).action,
    "allow"
  );
  const warned = controller.afterCall(
    "write_file",
    { path, content: "# New Title\n\nRewritten" },
    ok,
    false
  );
  assert.equal(warned.action, "warn");
  assert.equal(warned.code, "write_file_overwrite_warning");
  const blocked = controller.beforeCall("write_file", {
    path,
    content: "# Third rewrite\n\nAgain",
  });
  assert.equal(blocked.action, "block");
  assert.equal(blocked.code, "write_file_overwrite_block");
});

test("write_file append after overwrite remains allowed", () => {
  const controller = new ToolCallGuardrailController();
  const path = "projects/blog/article.md";
  const ok = JSON.stringify({ ok: true, path, bytes: 120 });
  controller.afterCall("write_file", { path, content: "# Title" }, ok, false);
  controller.afterCall("write_file", { path, content: "# Title v2" }, ok, false);
  assert.equal(
    controller.beforeCall("write_file", { path, content: "\n\nMore", append: true }).action,
    "allow"
  );
  assert.equal(
    controller.beforeCall("write_file", { path, content: "\n\nMore", append: "true" }).action,
    "allow"
  );
});

test("delete_file resets same-path write_file overwrite guardrail", () => {
  const controller = new ToolCallGuardrailController();
  const path = "projects/blog/article.md";
  const ok = JSON.stringify({ ok: true, path, bytes: 120 });
  controller.afterCall("write_file", { path, content: "# Title" }, ok, false);
  controller.afterCall("write_file", { path, content: "# Title v2" }, ok, false);
  assert.equal(
    controller.beforeCall("write_file", { path, content: "# Blocked rewrite" }).action,
    "block"
  );
  controller.afterCall("delete_file", { path }, JSON.stringify({ ok: true }), false);
  assert.equal(
    controller.beforeCall("write_file", { path, content: "# Fresh file after delete" }).action,
    "allow"
  );
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
