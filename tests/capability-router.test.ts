import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityRouterBlock,
  CAPABILITY_ROUTES,
} from "../dist/agent-runtime/capability-router.js";

test("buildCapabilityRouterBlock includes capability router header and env footer", () => {
  const block = buildCapabilityRouterBlock(["read_file", "web_fetch", "web_post", "run_python"]);
  assert.match(block, /# Capability router/);
  assert.match(block, /browser-runtime-map/);
  assert.match(block, /http-api/);
  assert.match(block, /Nodebox browser/);
  assert.match(block, /capability_list/);
});

test("buildCapabilityRouterBlock filters routes to available tools", () => {
  const block = buildCapabilityRouterBlock(["read_file", "grep", "browse_workspace"]);
  assert.match(block, /Read\/edit files/);
  assert.match(block, /Browse workspace/);
  assert.doesNotMatch(block, /composio_connect/);
});

test("buildCapabilityRouterBlock stays within char budget", () => {
  const allTools = CAPABILITY_ROUTES.flatMap((route) => route.tools);
  const block = buildCapabilityRouterBlock([...new Set(allTools), "read_file"]);
  assert.ok(block.length <= 2200, `router block too large: ${block.length}`);
});
