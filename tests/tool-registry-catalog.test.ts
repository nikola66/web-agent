import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

const EXPECTED_TOOLS = [
  "apply_patch",
  "archive_list",
  "artifact_present",
  "audio_analyze",
  "browse_workspace",
  "composio_action",
  "composio_connect",
  "composio_status",
  "cron_list",
  "cron_register",
  "delete_file",
  "docx_extract",
  "edit_file",
  "email",
  "extract_archive",
  "file_diff",
  "find_files",
  "grep",
  "image_info",
  "list_dir",
  "make_dir",
  "memory_forget",
  "memory_recall",
  "memory_save",
  "memory_search",
  "move_file",
  "multi_edit",
  "pdf_extract",
  "read_file",
  "run_python",
  "run_shell",
  "session_memory_append",
  "session_memory_list",
  "session_search",
  "skill_bulk_save",
  "skill_list",
  "skill_manage",
  "skill_view",
  "system_info",
  "todo_write",
  "tool_activate",
  "tool_search",
  "tree",
  "vision_analyze",
  "web_fetch",
  "web_post",
  "web_upload",
  "web_search",
  "wiki_search",
  "wiki_setup",
  "wiki_sync",
  "write_file",
  "youtube_transcribe",
].sort();

const LLM_HIDDEN_TOOLS = new Set(["find_files", "list_dir", "tree"]);

test("built-in tool registry and catalog keys match", async () => {
  const registry = await import("../dist/agent-runtime/tools/registry.js");
  const browser = await import("../dist/agent-runtime/tools/registry-browser.js");
  const regKeys = Object.keys(registry.BUILTIN_TOOLS).sort();
  const catKeys = Object.keys(browser.BUILTIN_TOOLS).sort();
  assert.deepEqual(regKeys, EXPECTED_TOOLS, "Node registry tool keys");
  assert.deepEqual(catKeys, EXPECTED_TOOLS, "Browser catalog stub tool keys");

  const sourceDir = nodePath.join(process.cwd(), "src/agent/runtime/tools/builtins");
  const sourceKeys = (await fs.readdir(sourceDir))
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((name) => name.slice(0, -3))
    .sort();
  assert.deepEqual(sourceKeys, EXPECTED_TOOLS, "One built-in tool definition file per tool");

  const nodeCatalog = await registry.loadToolCatalog();
  for (const name of EXPECTED_TOOLS) {
    assert.deepEqual(browser.BUILTIN_TOOLS[name], nodeCatalog[name], `${name} browser metadata should match runtime metadata`);
  }
});

// Pillar 1 — schema visibility. A tool with a contentless inputSchema is a
// black hole: the model gets no shape signal and validateRequiredArguments has
// nothing to check, so wrong-shaped args (e.g. todo_write's `items`) get eaten
// silently. Every builtin must declare its properties, except genuine no-arg
// tools listed here. Adding a new contentless-schema tool must fail this test.
const NO_ARG_TOOLS = new Set(["cron_list", "skill_list", "system_info"]);

test("every builtin declares an input schema (no black-hole tools)", async () => {
  const registry = await import("../dist/agent-runtime/tools/registry.js");
  const offenders: string[] = [];
  for (const [name, def] of Object.entries(registry.BUILTIN_TOOLS)) {
    if (NO_ARG_TOOLS.has(name)) continue;
    const props = (def as { inputSchema?: { properties?: Record<string, unknown> } })?.inputSchema
      ?.properties;
    const count = props && typeof props === "object" ? Object.keys(props).length : 0;
    if (count === 0) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `These tools ship a contentless inputSchema. Declare their properties, or add to NO_ARG_TOOLS if they truly take no args: ${offenders.join(", ")}`
  );
});

test("buildOpenAiToolDefinitions omits llmVisible:false alias tools", async () => {
  const registry = await import("../dist/agent-runtime/tools/registry.js");
  const catalog = await registry.loadToolCatalog();
  const defs = await registry.buildOpenAiToolDefinitions(catalog);
  const names = defs.map((d) => d.function?.name).filter(Boolean);
  assert.ok(names.includes("browse_workspace"));
  for (const hidden of LLM_HIDDEN_TOOLS) {
    assert.ok(!names.includes(hidden), `${hidden} should be execution-only alias`);
  }
});

test("buildOpenAiToolDefinitions strips JSON Schema examples from LLM parameters", async () => {
  const registry = await import("../dist/agent-runtime/tools/registry.js");
  const catalog = await registry.loadToolCatalog();
  const defs = await registry.buildOpenAiToolDefinitions(catalog);
  const mem = defs.find((d) => d.function?.name === "memory_save");
  assert.equal("examples" in (mem?.function?.parameters || {}), false);
  assert.ok(Array.isArray(catalog.memory_save?.inputSchema?.examples));
});

test("source tool capabilities have manifests and handlers", async () => {
  const capabilityDir = nodePath.join(process.cwd(), "src/capabilities/tools");
  const entries = await fs.readdir(capabilityDir, { withFileTypes: true }).catch(() => []);
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = nodePath.join(capabilityDir, entry.name);
    const manifest = JSON.parse(await fs.readFile(nodePath.join(dir, "manifest.json"), "utf8"));
    await fs.access(nodePath.join(dir, "handler.ts"));
    assert.match(manifest.id, /^[a-z][a-z0-9_]*$/);
    assert.equal(typeof manifest.description, "string");
    ids.push(manifest.id);
  }
  assert.ok(ids.includes("capability_list"));
});

test("skill catalog separates read-only vs guarded skill writes", async () => {
  const browser = await import("../dist/agent-runtime/tools/registry-browser.js");
  const readTools = ["skill_list", "skill_view", "skill_manage"];
  const guardedWrites = ["skill_bulk_save"];

  for (const name of readTools) {
    assert.ok(!browser.BUILTIN_TOOLS[name].requiresConfirmation, `${name} should stay read-only by default`);
  }

  for (const name of guardedWrites) {
    assert.equal(browser.BUILTIN_TOOLS[name].requiresConfirmation, true, `${name} should require confirmation`);
  }
});

test("composio action is read-friendly and only gates outbound/destructive calls", async () => {
  const browser = await import("../dist/agent-runtime/tools/registry-browser.js");
  assert.equal(browser.BUILTIN_TOOLS.composio_action.requiresConfirmation, false);
  assert.ok(!browser.BUILTIN_TOOLS.composio_status.requiresConfirmation);
  assert.ok(!browser.BUILTIN_TOOLS.composio_connect.requiresConfirmation);
});
