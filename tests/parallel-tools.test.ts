import test from "node:test";
import assert from "node:assert/strict";

import {
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

test("PARALLEL_SAFE_TOOLS includes web_search and web_fetch", () => {
  assert.ok(PARALLEL_SAFE_TOOLS.has("web_search"));
  assert.ok(PARALLEL_SAFE_TOOLS.has("web_fetch"));
  assert.ok(PARALLEL_SAFE_TOOLS.has("grep"));
});
