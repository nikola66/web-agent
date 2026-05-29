import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMcpToolsCache,
  describeMcpReload,
  formatMcpStartupBanner,
  getMcpCatalogCache,
  getMcpToolsCache,
} from "../src/agent/runtime/mcp-registry.js";

test("mcp registry cache starts empty", () => {
  clearMcpToolsCache();
  assert.deepEqual(getMcpToolsCache(), {});
  assert.deepEqual(getMcpCatalogCache(), {});
});

test("formatMcpStartupBanner", () => {
  const text = formatMcpStartupBanner(
    [
      { name: "mcp_a_x", description: "d", inputSchema: {}, server: "a", mcpToolName: "x" },
      { name: "mcp_b_y", description: "d", inputSchema: {}, server: "b", mcpToolName: "y" },
    ],
    1
  );
  assert.match(text, /2 tool\(s\) from 2 server\(s\)/);
  assert.match(text, /1 failed/);
});

test("describeMcpReload surfaces per-server failure reason", () => {
  const text = describeMcpReload([], {
    servers: [{ name: "directus", connected: false, toolCount: 0, error: "connect timed out" }],
    toolCount: 0,
    failed: 1,
  });
  assert.match(text, /0 tool\(s\)/);
  assert.match(text, /1 failed/);
  assert.match(text, /directus: connect timed out/);
});

test("describeMcpReload appends auth hint when nothing loaded", () => {
  const text = describeMcpReload(
    [],
    { servers: [{ name: "directus", connected: false, toolCount: 0 }], toolCount: 0, failed: 1 },
    "set directus_token in .webagent/mcp-secrets.json"
  );
  assert.match(text, /set directus_token/);
});

test("describeMcpReload is quiet on full success", () => {
  const text = describeMcpReload(
    [{ name: "mcp_a_x", description: "d", inputSchema: {}, server: "a", mcpToolName: "x" }],
    { servers: [{ name: "a", connected: true, toolCount: 1 }], toolCount: 1, failed: 0 },
    "ignored hint"
  );
  assert.match(text, /1 tool\(s\) from 1 server\(s\)/);
  assert.doesNotMatch(text, /failed|—|hint/);
});
