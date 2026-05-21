import test from "node:test";
import assert from "node:assert/strict";

import {
  dropThinkingOnlyAndMergeUsers,
  dropTrailingEmptyResponseScaffolding,
  isThinkingOnlyAssistant,
  repairMessageSequence,
  sanitizeApiMessages,
  sanitizeMessagesForLlm,
} from "../dist/agent-runtime/message-sanitizer.js";

test("isThinkingOnlyAssistant detects empty and thought-only assistant turns", () => {
  assert.equal(isThinkingOnlyAssistant({ role: "assistant", content: "" }), true);
  assert.equal(isThinkingOnlyAssistant({ role: "assistant", content: "thought" }), true);
  assert.equal(isThinkingOnlyAssistant({ role: "assistant", content: "Done." }), false);
});

test("sanitizeApiMessages removes orphaned tool results and stubs missing results", () => {
  const messages = [
    { role: "system", content: "sys" },
    {
      role: "assistant",
      content: "calling tool",
      tool_calls: [{ id: "call_1", function: { name: "read_file", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "orphan", content: "stale" },
  ];
  const out = sanitizeApiMessages(messages);
  assert.equal(out.length, 3);
  assert.equal(out[2].role, "tool");
  assert.equal(out[2].tool_call_id, "call_1");
  assert.match(String(out[2].content), /Result unavailable/);
});

test("dropThinkingOnlyAndMergeUsers merges adjacent user messages", () => {
  const out = dropThinkingOnlyAndMergeUsers([
    { role: "user", content: "first" },
    { role: "assistant", content: "thought" },
    { role: "user", content: "second" },
  ]);
  assert.equal(out.length, 1);
  assert.match(String(out[0].content), /first/);
  assert.match(String(out[0].content), /second/);
});

test("repairMessageSequence drops orphan tool messages and merges users", () => {
  const out = repairMessageSequence([
    { role: "assistant", tool_calls: [{ id: "call_1", function: { name: "read_file" } }] },
    { role: "tool", tool_call_id: "orphan", content: "stale" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, "assistant");
  assert.equal(out[1].role, "user");
  assert.match(String(out[1].content), /a/);
  assert.match(String(out[1].content), /b/);
});

test("dropTrailingEmptyResponseScaffolding removes synthetic recovery tail", () => {
  const out = dropTrailingEmptyResponseScaffolding([
    { role: "assistant", content: "final" },
    { role: "assistant", content: "(empty)", _empty_recovery_synthetic: true },
    { role: "user", content: "nudge", _empty_recovery_synthetic: true },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "final");
});

test("sanitizeMessagesForLlm applies both passes without mutating input", () => {
  const input = [
    { role: "user", content: "a" },
    { role: "assistant", content: "" },
    { role: "user", content: "b" },
  ];
  const out = sanitizeMessagesForLlm(input);
  assert.equal(out.length, 1);
  assert.equal(input.length, 3);
});
