import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearMcpToolsCache,
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
