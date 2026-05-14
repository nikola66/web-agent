import test from "node:test";
import assert from "node:assert/strict";

import { hoistNestedToolArguments } from "../dist/agent-runtime/tools/llm-arg-shape.js";
import { TOOL_HARDENING_PRIORITY } from "../dist/agent-runtime/tools/tool-hardening-priority.js";

test("tool hardening priority audit list is populated", () => {
  assert.ok(Array.isArray(TOOL_HARDENING_PRIORITY));
  assert.ok(TOOL_HARDENING_PRIORITY.length >= 3);
  assert.ok(TOOL_HARDENING_PRIORITY.some((r) => r.tool === "email"));
});

test("hoistNestedToolArguments flattens double-wrapped payload", () => {
  const out = hoistNestedToolArguments("run_shell", {
    arguments: { command: "node --version" },
  }) as Record<string, unknown>;
  assert.equal(out.command, "node --version");
  assert.equal(out.arguments, undefined);
});

test("hoistNestedToolArguments outer keys win on collision", () => {
  const out = hoistNestedToolArguments("memory_save", {
    arguments: { key: "inner", value: "wrong" },
    value: "right",
  }) as Record<string, unknown>;
  assert.equal(out.key, "inner");
  assert.equal(out.value, "right");
});

test("hoistNestedToolArguments is a no-op for cron_register job shape", () => {
  const job = {
    id: "daily",
    everyMinutes: 1440,
    tool: "web_search",
    arguments: { query: "news", page: 0 },
  };
  assert.strictEqual(hoistNestedToolArguments("cron_register", job), job);
});

test("hoistNestedToolArguments recurses multiple wrappers", () => {
  const out = hoistNestedToolArguments("grep", {
    arguments: { arguments: { pattern: "foo", path: "." } },
  }) as Record<string, unknown>;
  assert.equal(out.pattern, "foo");
  assert.equal(out.path, ".");
});
