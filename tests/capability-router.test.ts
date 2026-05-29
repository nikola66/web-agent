import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCapabilityRouterBlock,
  STATIC_CAPABILITY_ROUTES,
} from "../dist/agent-runtime/capability-router.js";

test("buildCapabilityRouterBlock includes capability router header and env footer", async () => {
  const block = await buildCapabilityRouterBlock(["read_file", "web_fetch", "web_post", "run_python"]);
  assert.match(block, /# Capability router/);
  assert.match(block, /browser-runtime-map|Browse workspace/);
  assert.match(block, /http-api|REST|GraphQL/i);
  assert.match(block, /Nodebox browser/);
});

test("buildCapabilityRouterBlock filters deferred routes but keeps OAuth SaaS hint", async () => {
  const block = await buildCapabilityRouterBlock(["read_file", "grep", "browse_workspace"]);
  assert.match(block, /Browse workspace/);
  assert.match(block, /OAuth|composio/i);
  assert.doesNotMatch(block, /wiki_search/);
});

test("buildCapabilityRouterBlock always shows OAuth SaaS route when composio tools deferred", async () => {
  const block = await buildCapabilityRouterBlock(["read_file", "web_fetch", "skill"]);
  assert.match(block, /OAuth|composio/i);
  assert.match(block, /composio-oauth/);
  assert.match(block, /composio_status/);
});

test("buildCapabilityRouterBlock includes CMS upload route", async () => {
  const block = await buildCapabilityRouterBlock(["web_fetch", "web_post", "web_upload"]);
  assert.match(block, /web_upload/);
  assert.match(block, /never base64/);
});

test("buildCapabilityRouterBlock stays within char budget", async () => {
  const allTools = STATIC_CAPABILITY_ROUTES.flatMap((route) => route.tools);
  const block = await buildCapabilityRouterBlock([...new Set(allTools), "read_file"]);
  assert.ok(block.length <= 2200, `router block too large: ${block.length}`);
});
