import test from "node:test";
import assert from "node:assert/strict";

import { viewSkill } from "../dist/agent-runtime/memory/index.js";
import { normalizeToolCalls } from "../dist/agent-runtime/llm/streaming.js";
import {
  DEFAULT_TOOL_POLICY,
  canUnlockTool,
  resolveInitialActiveToolNames,
  resolvePolicyToolNames,
  TOOL_GROUPS,
} from "../src/agent/runtime/tools/tool-policy-config.ts";
import { describeDeferredTool } from "../src/agent/runtime/tools/tool-search-tools.ts";

const POLICY_NAMES = Object.values(TOOL_GROUPS).flat();

test("skill_view primary_tools unlock deferred composio tools when configured", async () => {
  const viewed = await viewSkill({ name: "composio-oauth" });
  assert.ok(Array.isArray(viewed.primary_tools));
  assert.ok(viewed.primary_tools.includes("composio_action"));

  const policyNames = resolvePolicyToolNames(POLICY_NAMES, DEFAULT_TOOL_POLICY, {
    WEBAGENT_COMPOSIO_API_KEY: "test-key",
  });
  const initial = resolveInitialActiveToolNames(
    policyNames,
    POLICY_NAMES,
    DEFAULT_TOOL_POLICY,
    { WEBAGENT_COMPOSIO_API_KEY: "test-key" },
    []
  );
  assert.ok(!initial.includes("composio_action"));

  const unlocked = resolveInitialActiveToolNames(
    policyNames,
    POLICY_NAMES,
    DEFAULT_TOOL_POLICY,
    { WEBAGENT_COMPOSIO_API_KEY: "test-key" },
    viewed.primary_tools
  );
  assert.ok(unlocked.includes("composio_action"));
});

test("canUnlockTool blocks composio tools without API key", () => {
  assert.equal(canUnlockTool("composio_action", POLICY_NAMES, DEFAULT_TOOL_POLICY, {}), false);
  assert.equal(
    canUnlockTool("composio_action", POLICY_NAMES, DEFAULT_TOOL_POLICY, {
      WEBAGENT_COMPOSIO_API_KEY: "test-key",
    }),
    true
  );
});

test("skill_view primary_tools match bundled multimodal-ingest frontmatter", async () => {
  const viewed = await viewSkill({ name: "multimodal-ingest" });
  assert.ok(Array.isArray(viewed.primary_tools));
  assert.ok(viewed.primary_tools.includes("vision_analyze"));
  assert.ok(viewed.primary_tools.includes("youtube_transcribe"));
});

test("hidden browse aliases stay executable via full tool-name normalization", async () => {
  const registry = await import("../dist/agent-runtime/tools/registry.js");
  const allNames = Object.keys(registry.BUILTIN_TOOLS);
  const hidden = ["list_dir", "tree", "find_files"];
  for (const name of hidden) {
    const args =
      name === "find_files" ? { pattern: "*.md", root: "." } : { path: "." };
    const { normalized, rejected } = normalizeToolCalls([{ name, arguments: args }], allNames);
    assert.equal(rejected.length, 0, `${name} should not be rejected`);
    assert.equal(normalized[0]?.name, name);
  }
});

test("tool_activate can describe llm-hidden deferred aliases", async () => {
  const meta = await describeDeferredTool("list_dir");
  assert.ok(meta);
  assert.equal(meta?.name, "list_dir");
});
