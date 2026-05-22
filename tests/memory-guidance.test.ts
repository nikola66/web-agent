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
  assert.match(block, /plain JSON with the schema keys/);
  assert.match(block, /grep\/find_files: `pattern`/);
});

test("buildMemoryLayerGuidanceBlock includes workspace browse guidance for list_dir", () => {
  const block = buildMemoryLayerGuidanceBlock(["list_dir", "read_file"]);
  assert.match(block, /Never use `\/`/);
  assert.match(block, /run `list_dir/);
  assert.match(block, /`pattern`/);
  assert.match(block, /grep.*`root`/i);
});

test("buildMemoryLayerGuidanceBlock includes workspace browse guidance for read_file alone", () => {
  const block = buildMemoryLayerGuidanceBlock(["read_file"]);
  assert.match(block, /run `list_dir/);
  assert.match(block, /workspace root/);
});

test("buildMemoryLayerGuidanceBlock returns empty when no memory layer tools", () => {
  assert.equal(buildMemoryLayerGuidanceBlock(["web_fetch"]), "");
});

test("buildMemoryLayerGuidanceBlock includes script porting when run_shell enabled", () => {
  const block = buildMemoryLayerGuidanceBlock(["run_shell", "read_file"]);
  assert.match(block, /script-porting/);
  assert.match(block, /python_to_node/);
  assert.match(block, /Nodebox runs JavaScript only/);
  assert.match(block, /`cwd`/);
  assert.match(block, /`env`/);
});
