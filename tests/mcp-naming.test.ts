import { test } from "node:test";
import assert from "node:assert/strict";
import { mcpEnvKeyForServer, mcpToolRegistryName, sanitizeMcpNameComponent } from "../src/core/mcp/naming.js";

test("sanitizeMcpNameComponent replaces invalid chars and lowercases", () => {
  assert.equal(sanitizeMcpNameComponent("git-hub"), "git_hub");
  assert.equal(sanitizeMcpNameComponent("tool.name"), "tool_name");
  assert.equal(sanitizeMcpNameComponent("GitHub"), "github");
});

test("mcpToolRegistryName matches Hermes pattern", () => {
  assert.equal(mcpToolRegistryName("github", "create_issue"), "mcp_github_create_issue");
});

test("mcpEnvKeyForServer", () => {
  assert.equal(mcpEnvKeyForServer("my-server"), "MCP_MY_SERVER_API_KEY");
});
