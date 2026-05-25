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
  assert.match(block, /grep\/browse find: `pattern`/);
});

test("buildMemoryLayerGuidanceBlock includes workspace browse guidance for browse_workspace", () => {
  const block = buildMemoryLayerGuidanceBlock(["browse_workspace", "read_file"]);
  assert.match(block, /Never use `\/`/);
  assert.match(block, /browse_workspace/);
  assert.match(block, /`pattern`/);
  assert.match(block, /grep.*`root`/i);
});

test("buildMemoryLayerGuidanceBlock includes spill recovery when read_file enabled", () => {
  const block = buildMemoryLayerGuidanceBlock(["read_file"]);
  assert.match(block, /memory\/snapshots/);
  assert.match(block, /memory\/runs/);
});

test("buildMemoryLayerGuidanceBlock includes HTTP upload guidance when web tools enabled", () => {
  const block = buildMemoryLayerGuidanceBlock(["web_fetch"]);
  assert.match(block, /web_upload/);
  assert.match(block, /never base64/i);
});

test("buildMemoryLayerGuidanceBlock includes HTTP guidance with web_post and spill recovery with read_file", () => {
  const block = buildMemoryLayerGuidanceBlock(["web_fetch", "web_post", "run_shell", "read_file"]);
  assert.match(block, /web_upload/);
  assert.match(block, /memory\/snapshots/);
  assert.doesNotMatch(block, /Nodebox has no POSIX shell or system pip/);
});

test("buildMemoryLayerGuidanceBlock includes composio guidance when skill_view enabled", () => {
  const block = buildMemoryLayerGuidanceBlock(["skill_view", "read_file"]);
  assert.match(block, /composio-oauth/);
  assert.match(block, /composio_status/);
  assert.match(block, /no access/);
});
