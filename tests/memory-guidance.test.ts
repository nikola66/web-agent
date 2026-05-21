import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemoryLayerGuidanceBlock,
} from "../dist/agent-runtime/memory-guidance.js";

test("buildMemoryLayerGuidanceBlock includes memory guidance when memory tools enabled", () => {
  const block = buildMemoryLayerGuidanceBlock(["memory_save", "read_file"]);
  assert.match(block, /Memory layers/);
  assert.match(block, /memory_save/);
  assert.match(block, /persistent memory across sessions/);
});

test("buildMemoryLayerGuidanceBlock includes session guidance when session tools enabled", () => {
  const block = buildMemoryLayerGuidanceBlock([
    "session_search",
    "session_memory_append",
    "session_memory_list",
  ]);
  assert.match(block, /session_memory_append/);
  assert.match(block, /past conversation/);
});

test("buildMemoryLayerGuidanceBlock returns empty when no memory layer tools", () => {
  assert.equal(buildMemoryLayerGuidanceBlock(["read_file", "web_fetch"]), "");
});
