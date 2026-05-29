import test from "node:test";
import assert from "node:assert/strict";

import {
  isParallelSafeToolCall,
  PARALLEL_SAFE_TOOLS,
  shouldParallelizeToolBatch,
} from "../dist/agent-runtime/tools/registry.js";

test("shouldParallelizeToolBatch is true for multiple web_search calls", () => {
  const batch = [
    { name: "web_search" },
    { name: "web_search" },
    { name: "web_fetch" },
  ];
  assert.equal(shouldParallelizeToolBatch(batch), true);
});

test("shouldParallelizeToolBatch is false for a single tool", () => {
  assert.equal(shouldParallelizeToolBatch([{ name: "web_search" }]), false);
});

test("shouldParallelizeToolBatch is false when batch mixes write_file", () => {
  const batch = [{ name: "web_search" }, { name: "write_file" }];
  assert.equal(shouldParallelizeToolBatch(batch), false);
});

test("shouldParallelizeToolBatch is false when skill manage is in the batch", () => {
  const batch = [
    { name: "skill", args: { action: "view", name: "http-api" } },
    { name: "skill", args: { action: "manage", manage_action: "patch", name: "demo" } },
  ];
  assert.equal(shouldParallelizeToolBatch(batch), false);
});

test("isParallelSafeToolCall allows skill list and view only", () => {
  assert.equal(isParallelSafeToolCall("skill", { action: "list" }), true);
  assert.equal(isParallelSafeToolCall("skill", { action: "view", name: "x" }), true);
  assert.equal(isParallelSafeToolCall("skill", { action: "manage", manage_action: "create" }), false);
  assert.equal(isParallelSafeToolCall("skill", { action: "bulk", items: [{ url: "https://x" }] }), false);
});

test("PARALLEL_SAFE_TOOLS includes web_search and web_fetch", () => {
  assert.ok(PARALLEL_SAFE_TOOLS.has("web_search"));
  assert.ok(PARALLEL_SAFE_TOOLS.has("web_fetch"));
  assert.ok(PARALLEL_SAFE_TOOLS.has("grep"));
  assert.ok(!PARALLEL_SAFE_TOOLS.has("skill"));
});
