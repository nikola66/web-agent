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

test("buildCapabilityRouterBlock filters deferred routes but keeps OAuth SaaS hint", () => {
  const block = buildCapabilityRouterBlock(["read_file", "grep", "browse_workspace"]);
  assert.match(block, /Read\/edit files/);
  assert.match(block, /Browse workspace/);
  assert.match(block, /OAuth SaaS/);
  assert.doesNotMatch(block, /wiki_search/);
});

test("buildCapabilityRouterBlock always shows OAuth SaaS route when composio tools deferred", () => {
  const block = buildCapabilityRouterBlock(["read_file", "web_fetch", "skill_view"]);
  assert.match(block, /OAuth SaaS/);
  assert.match(block, /composio-oauth/);
  assert.match(block, /composio_status/);
  assert.match(block, /claiming no access before composio_status/);
});

test("buildCapabilityRouterBlock includes CMS upload route", () => {
  const block = buildCapabilityRouterBlock(["web_fetch", "web_post", "web_upload"]);
  assert.match(block, /CMS\/file upload/);
  assert.match(block, /web_upload/);
  assert.match(block, /never base64/);
});

test("buildCapabilityRouterBlock stays within char budget", () => {
  const allTools = CAPABILITY_ROUTES.flatMap((route) => route.tools);
  const block = buildCapabilityRouterBlock([...new Set(allTools), "read_file"]);
  assert.ok(block.length <= 2200, `router block too large: ${block.length}`);
});
