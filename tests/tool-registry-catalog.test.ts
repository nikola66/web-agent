import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";

const EXPECTED_TOOLS = [
  "apply_patch",
  "artifact_present",
  "cron_list",
  "cron_register",
  "delete_file",
  "edit_file",
  "email",
  "file_diff",
  "file_stat",
  "find_files",
  "grep",
  "list_dir",
  "make_dir",
  "memory_recall",
  "memory_save",
  "memory_search",
  "move_file",
  "multi_edit",
  "read_file",
  "run_shell",
  "session_memory_append",
  "session_memory_list",
  "session_search",
  "skill_bulk_save",
  "skill_delete",
  "skill_list",
  "skill_manage",
  "skill_recall",
  "skill_save",
  "skill_view",
  "system_info",
  "todo_write",
  "tree",
  "vision_analyze",
  "web_fetch",
  "web_search",
  "write_file",
  "youtube_transcribe",
].sort();

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
  const readTools = ["skill_list", "skill_view", "skill_recall", "skill_save", "skill_manage"];
  const guardedWrites = ["skill_delete", "skill_bulk_save"];

  for (const name of readTools) {
    assert.ok(!browser.BUILTIN_TOOLS[name].requiresConfirmation, `${name} should stay read-only`);
  }

  for (const name of guardedWrites) {
    assert.equal(browser.BUILTIN_TOOLS[name].requiresConfirmation, true, `${name} should require confirmation`);
  }
});
