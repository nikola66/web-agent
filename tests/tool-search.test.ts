import test from "node:test";
import assert from "node:assert/strict";
import { isDeferredCatalogTool } from "../src/agent/runtime/tools/tool-search-tools.ts";

test("isDeferredCatalogTool marks llmVisible false and mcp tools", () => {
  assert.equal(isDeferredCatalogTool("list_dir", { llmVisible: false }), true);
  assert.equal(isDeferredCatalogTool("mcp_github_search", {}), true);
  assert.equal(isDeferredCatalogTool("read_file", {}), false);
});

test("tool_activate schema requires name", async () => {
  const mod = await import("../dist/agent-runtime/tools/builtins/tool_activate.js");
  assert.equal(mod.default.name, "tool_activate");
  assert.deepEqual(mod.default.inputSchema.required, ["name"]);
});

test("tool_search is in core tool group policy", async () => {
  const { TOOL_GROUPS } = await import("../src/agent/runtime/tools/tool-policy-config.ts");
  assert.ok(TOOL_GROUPS.core.includes("tool_search"));
  assert.ok(TOOL_GROUPS.core.includes("tool_activate"));
});
