import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpEnvForConfig } from "../src/agent/runtime/mcp-config.js";

test("mcpEnvForConfig includes referenced vars and MCP_* keys only", () => {
  const prev = { ...process.env };
  process.env.MCP_GITHUB_API_KEY = "gh-secret";
  process.env.UNRELATED_KEY = "noise";
  process.env.MCP_OTHER = "keep";
  try {
    const env = mcpEnvForConfig({
      github: {
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${MCP_GITHUB_API_KEY}" },
      },
    });
    assert.equal(env.MCP_GITHUB_API_KEY, "gh-secret");
    assert.equal(env.MCP_OTHER, "keep");
    assert.equal(env.UNRELATED_KEY, undefined);
  } finally {
    process.env = prev;
  }
});
