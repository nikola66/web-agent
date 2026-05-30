import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOOL_POLICY,
  resolvePolicyToolNames,
  resolveInitialActiveToolNames,
  canUnlockTool,
  resetToolPolicyCacheForTest,
  TOOL_GROUPS,
} from "../src/agent/runtime/tools/tool-policy-config.ts";
import { resolveToolVisibility } from "../src/agent/runtime/tools/tool-visibility.ts";

function catalogForNames(names: string[]): Record<string, { visibility?: string }> {
  return Object.fromEntries(names.map((name) => [name, { visibility: resolveToolVisibility(name, null) }]));
}

test("empty allow expands to all registered tools", () => {
  const all = ["read_file", "wiki_search", "composio_action"];
  assert.deepEqual(resolvePolicyToolNames(all, { allow: [], deny: [] }), all.sort());
  assert.deepEqual(resolvePolicyToolNames(all, null), all.sort());
});

test("default policy allow groups omit deferred wiki tools initially", () => {
  const all = Object.values(TOOL_GROUPS).flat();
  const policyNames = resolvePolicyToolNames(all, DEFAULT_TOOL_POLICY, {});
  assert.ok(policyNames.includes("read_file"));
  assert.ok(policyNames.includes("browse_workspace"));
  assert.ok(!policyNames.includes("wiki_search"));
  assert.ok(!policyNames.includes("composio_action"));
});

test("auto composio when configured adds composio tools to allow expansion", () => {
  const all = Object.values(TOOL_GROUPS).flat();
  const policy = {
    ...DEFAULT_TOOL_POLICY,
    allow: [...(DEFAULT_TOOL_POLICY.allow || []), "group:composio"],
  };
  const withoutKey = resolvePolicyToolNames(all, policy, {});
  assert.ok(!withoutKey.includes("composio_action"));
  const withKey = resolvePolicyToolNames(all, policy, { WEBAGENT_COMPOSIO_API_KEY: "test-key" });
  assert.ok(withKey.includes("composio_action"));
});

test("resolveInitialActiveToolNames unlocks deferred tools after skill (action=view)", () => {
  const all = Object.values(TOOL_GROUPS).flat();
  const catalog = catalogForNames(all);
  const policyNames = resolvePolicyToolNames(all, DEFAULT_TOOL_POLICY, {});
  const initial = resolveInitialActiveToolNames(policyNames, catalog, all, DEFAULT_TOOL_POLICY, {}, []);
  assert.ok(!initial.includes("wiki_search"));
  const unlocked = resolveInitialActiveToolNames(
    policyNames,
    catalog,
    all,
    DEFAULT_TOOL_POLICY,
    {},
    ["wiki_search"]
  );
  assert.ok(unlocked.includes("wiki_search"));
});

test("canUnlockTool permits mcp deferred tools", () => {
  const all = ["tool_search", "mcp_github_create_issue"];
  const catalog = catalogForNames(all);
  assert.equal(canUnlockTool("mcp_github_create_issue", catalog, all, DEFAULT_TOOL_POLICY, {}), true);
});

test("default policy does not auto-include mcp tools in policy allow list", () => {
  const all = [...Object.values(TOOL_GROUPS).flat(), "mcp_hub_items_list"];
  const policyNames = resolvePolicyToolNames(all, DEFAULT_TOOL_POLICY, {});
  assert.ok(!policyNames.includes("mcp_hub_items_list"));
  assert.ok(!policyNames.includes("wiki_search"));
});

test("session-unlocked mcp tools become active", () => {
  const all = ["read_file", "mcp_hub_items_list"];
  const catalog = catalogForNames(all);
  const policyNames = resolvePolicyToolNames(all, DEFAULT_TOOL_POLICY, {});
  const active = resolveInitialActiveToolNames(
    policyNames,
    catalog,
    all,
    DEFAULT_TOOL_POLICY,
    {},
    ["mcp_hub_items_list"]
  );
  assert.ok(active.includes("mcp_hub_items_list"));
  assert.ok(!active.includes("wiki_search"));
});

test("resetToolPolicyCacheForTest clears cached policy", () => {
  resetToolPolicyCacheForTest();
  assert.doesNotThrow(() => resetToolPolicyCacheForTest());
});
