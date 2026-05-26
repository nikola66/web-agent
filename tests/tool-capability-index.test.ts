import test from "node:test";
import assert from "node:assert/strict";

import { BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry-browser.js";
import {
  briefToolDescription,
  buildToolCapabilityIndexBlock,
  invalidateToolCapabilityIndexCache,
  toolCapabilityIndexFingerprint,
} from "../src/agent/runtime/tool-capability-index.ts";
import {
  DEFAULT_TOOL_POLICY,
  resolveInitialActiveToolNames,
  resolvePolicyToolNames,
  TOOL_GROUPS,
} from "../src/agent/runtime/tools/tool-policy-config.ts";

const ALL_BUILTIN_NAMES = Object.keys(BUILTIN_TOOLS);
const POLICY_NAMES = Object.values(TOOL_GROUPS).flat();

function mockCatalog(
  names: string[],
  extra: Record<string, { description?: string }> = {}
): Record<string, { description?: string }> {
  const catalog: Record<string, { description?: string }> = { ...extra };
  for (const name of names) {
    const entry = BUILTIN_TOOLS[name as keyof typeof BUILTIN_TOOLS] as
      | { description?: string }
      | undefined;
    catalog[name] = {
      description: entry?.description || `${name} test description.`,
    };
  }
  return catalog;
}

test("briefToolDescription uses first sentence within max chars", () => {
  assert.equal(briefToolDescription("First sentence. Second one."), "First sentence.");
  const long = "A".repeat(120);
  assert.ok(briefToolDescription(long, 40).endsWith("…"));
});

test("every builtin appears in index when policy allows all", () => {
  const prevBudget = process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET;
  process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET = "50000";
  const catalog = mockCatalog(ALL_BUILTIN_NAMES);
  const block = buildToolCapabilityIndexBlock({
    catalog,
    policyToolNames: ALL_BUILTIN_NAMES,
    activeToolNames: resolveInitialActiveToolNames(
      ALL_BUILTIN_NAMES,
      ALL_BUILTIN_NAMES,
      { allow: [], deny: [] },
      {},
      []
    ),
  });
  try {
    for (const name of ALL_BUILTIN_NAMES) {
      assert.match(
        block,
        new RegExp(`\\[(?:active|deferred)\\] ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
      );
    }
  } finally {
    if (prevBudget === undefined) delete process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET;
    else process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET = prevBudget;
  }
});

test("active core and deferred cron tags", () => {
  const catalog = mockCatalog(POLICY_NAMES);
  const policyWithCron = {
    ...DEFAULT_TOOL_POLICY,
    allow: [...(DEFAULT_TOOL_POLICY.allow || []), "group:cron"],
  };
  const policyNames = resolvePolicyToolNames(POLICY_NAMES, policyWithCron, {});
  const active = resolveInitialActiveToolNames(
    policyNames,
    POLICY_NAMES,
    policyWithCron,
    {},
    []
  );
  const block = buildToolCapabilityIndexBlock({
    catalog,
    policyToolNames: policyNames,
    activeToolNames: active,
  });
  assert.match(block, /\[active\] web_fetch/);
  assert.match(block, /\[deferred\] cron_register/);
  assert.doesNotMatch(block, /\[active\] cron_register/);
});

test("policy filter omits denied-by-default tools", () => {
  const catalog = mockCatalog(POLICY_NAMES);
  const policyNames = resolvePolicyToolNames(POLICY_NAMES, DEFAULT_TOOL_POLICY, {});
  const block = buildToolCapabilityIndexBlock({
    catalog,
    policyToolNames: policyNames,
    activeToolNames: ["read_file"],
  });
  assert.doesNotMatch(block, /wiki_search/);
  assert.doesNotMatch(block, /composio_action/);
});

test("MCP tools appear in index under default policy without explicit allow group", () => {
  const mcpName = "mcp_demo_server_items_list";
  const catalog = mockCatalog(["read_file"], {
    [mcpName]: { description: "[MCP:demo-server] List items." },
  });
  const policyNames = resolvePolicyToolNames(
    ["read_file", mcpName],
    DEFAULT_TOOL_POLICY,
    {}
  );
  const block = buildToolCapabilityIndexBlock({
    catalog,
    policyToolNames: policyNames,
    activeToolNames: ["read_file"],
  });
  assert.match(block, /## MCP \(demo-server\)/);
  assert.match(block, new RegExp(`\\[deferred\\] ${mcpName}`));
});

test("MCP tools grouped under server header", () => {
  const mcpTools = [
    "mcp_hub_aratech_ae_mcp_items_list",
    "mcp_hub_aratech_ae_mcp_items_read",
    "mcp_hub_aratech_ae_mcp_items_create",
  ];
  const catalog = mockCatalog(["read_file"], {
    [mcpTools[0]]: { description: "[MCP:hub-aratech-ae-mcp] List items." },
    [mcpTools[1]]: { description: "[MCP:hub-aratech-ae-mcp] Read one item." },
    [mcpTools[2]]: { description: "[MCP:hub-aratech-ae-mcp] Create item." },
  });
  const block = buildToolCapabilityIndexBlock({
    catalog,
    policyToolNames: ["read_file", ...mcpTools],
    activeToolNames: ["read_file"],
  });
  assert.match(block, /## MCP \(hub-aratech-ae-mcp\)/);
  assert.match(block, /\[deferred\] mcp_hub_aratech_ae_mcp_items_list/);
});

test("budget truncation keeps MCP summary when many MCP tools", () => {
  const prev = process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET;
  process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET = "900";
  try {
    const mcpNames = Array.from({ length: 12 }, (_, i) => `mcp_demo_server_tool_${i}`);
    const catalog: Record<string, { description?: string }> = {
      read_file: { description: "Read workspace files." },
    };
    for (const name of mcpNames) {
      catalog[name] = { description: `[MCP:demo-server] Tool ${name}.` };
    }
    const block = buildToolCapabilityIndexBlock({
      catalog,
      policyToolNames: ["read_file", ...mcpNames],
      activeToolNames: ["read_file"],
    });
    assert.match(block, /MCP|mcp|tool_search/i);
    assert.ok(
      block.includes("12 tools") || block.includes("MCP tool") || block.includes("demo-server")
    );
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET;
    else process.env.WEBAGENT_TOOL_INDEX_CHAR_BUDGET = prev;
  }
});

test("fingerprint changes when catalog or active set changes", () => {
  const catalog = mockCatalog(["read_file", "web_fetch"]);
  const a = toolCapabilityIndexFingerprint(catalog, ["read_file"], ["read_file"]);
  const b = toolCapabilityIndexFingerprint(catalog, ["read_file", "web_fetch"], ["read_file"]);
  const c = toolCapabilityIndexFingerprint(catalog, ["read_file"], ["read_file", "web_fetch"]);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  invalidateToolCapabilityIndexCache();
});

test("fingerprint changes when description text changes at same length", () => {
  const descA = "Alpha fingerprint description same length!!";
  const descB = "Beta fingerprint description same length!!!";
  assert.equal(descA.length, descB.length);
  const catalog = { read_file: { description: descA } };
  const a = toolCapabilityIndexFingerprint(catalog, ["read_file"], ["read_file"]);
  catalog.read_file = { description: descB };
  const b = toolCapabilityIndexFingerprint(catalog, ["read_file"], ["read_file"]);
  assert.notEqual(a, b);
});
