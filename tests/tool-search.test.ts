import test from "node:test";
import assert from "node:assert/strict";
import {
  isDeferredCatalogTool,
  isHiddenBrowseAlias,
  searchDeferredTools,
} from "../src/agent/runtime/tools/tool-search-tools.ts";

test("isDeferredCatalogTool marks llmVisible false but not mcp tools", () => {
  assert.equal(isDeferredCatalogTool("list_dir", { llmVisible: false }), true);
  assert.equal(isDeferredCatalogTool("mcp_github_search", {}), false);
  assert.equal(isDeferredCatalogTool("read_file", {}), false);
});

test("tool_activate schema requires name", async () => {
  const mod = await import("../dist/agent-runtime/tools/builtins/tool_activate.js");
  assert.equal(mod.default.name, "tool_activate");
  assert.deepEqual(mod.default.inputSchema.required, ["name"]);
});

test("searchDeferredTools empty query returns hidden browse aliases not mcp", async () => {
  const catalog = {
    list_dir: { description: "list one dir", llmVisible: false },
    find_files: { description: "find files", llmVisible: false },
    mcp_demo_server_items_list: { description: "[MCP:demo-server] List items.", llmVisible: false },
    mcp_demo_server_items_read: { description: "[MCP:demo-server] Read item.", llmVisible: false },
  };
  const matches = await searchDeferredTools("", new Set(["read_file"]), 12, catalog);
  assert.ok(matches.every((m) => isHiddenBrowseAlias(m.name)));
  assert.equal(matches.length, 2);
});

test("searchDeferredTools mcp query does not return mcp tools", async () => {
  const catalog = {
    list_dir: { description: "list", llmVisible: false },
    mcp_hub_items_list: { description: "[MCP:hub] List.", llmVisible: false },
  };
  const matches = await searchDeferredTools("mcp", new Set(["read_file"]), 12, catalog);
  assert.ok(matches.every((m) => !m.name.startsWith("mcp_")));
});

test("tool_search is in core tool group policy", async () => {
  const { TOOL_GROUPS } = await import("../src/agent/runtime/tools/tool-policy-config.ts");
  assert.ok(TOOL_GROUPS.core.includes("tool_search"));
  assert.ok(TOOL_GROUPS.core.includes("tool_activate"));
});
