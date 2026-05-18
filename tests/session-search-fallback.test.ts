import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { createToolContext } from "../dist/agent-runtime/tools/context.js";
import { loadToolCatalog, runTools } from "../dist/agent-runtime/tools/registry.js";

async function withIsolatedWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-session-search-"));
  const previousWorkspaceRoot = process.env.WEBAGENT_WORKSPACE_ROOT;
  const previousMemoryRoot = process.env.WEBAGENT_MEMORY_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  process.env.WEBAGENT_MEMORY_ROOT = nodePath.join(root, "memory");
  try {
    return await run(root);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousMemoryRoot === undefined) delete process.env.WEBAGENT_MEMORY_ROOT;
    else process.env.WEBAGENT_MEMORY_ROOT = previousMemoryRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("session_search falls back to run history when conversation archives are empty", async () => {
  await withIsolatedWorkspace(async (root) => {
    await fs.mkdir(nodePath.join(root, "memory", "runs"), { recursive: true });
    await fs.writeFile(
      nodePath.join(root, "memory", "runs", "run_abc.json"),
      JSON.stringify(
        {
          id: "run_abc",
          goal: "Create a comprehensive plan for YouTube creators",
          input: "Plan approved, execute it",
          final_visible_assistant_text: "Implemented the plan and validated tests.",
          tool_calls: [{ name: "read_file" }, { name: "write_file" }],
        },
        null,
        2
      ),
      "utf8"
    );

    const catalog = await loadToolCatalog();
    const ctx = createToolContext({ runId: "session_search_fallback_run", autoApprove: true });
    const [out] = await runTools(
      [{ name: "session_search", arguments: { query: "youtube creators plan" } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    const matches =
      (out?.result as { matches?: Array<{ path?: string; context?: string }> })?.matches || [];
    assert.ok(matches.length >= 1);
    assert.equal(matches[0]?.path, "memory/runs/run_abc.json");
    assert.match(String(matches[0]?.context || ""), /youtube creators/i);
  });
});

test("session_search falls back to .webagent/session-memory.jsonl", async () => {
  await withIsolatedWorkspace(async (root) => {
    await fs.mkdir(nodePath.join(root, ".webagent"), { recursive: true });
    await fs.writeFile(
      nodePath.join(root, ".webagent", "session-memory.jsonl"),
      `${JSON.stringify({
        ts: "2026-05-18T20:55:00.000Z",
        kind: "note",
        text: "We fixed approved-plan execution and directory-creation behavior.",
      })}\n`,
      "utf8"
    );

    const catalog = await loadToolCatalog();
    const ctx = createToolContext({ runId: "session_search_fallback_session_memory", autoApprove: true });
    const [out] = await runTools(
      [{ name: "session_search", arguments: { query: "approved-plan execution" } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    const matches =
      (out?.result as { matches?: Array<{ path?: string; context?: string }> })?.matches || [];
    assert.ok(matches.length >= 1);
    assert.equal(matches[0]?.path, ".webagent/session-memory.jsonl");
    assert.match(String(matches[0]?.context || ""), /approved-plan execution/i);
  });
});

test("session_search returns recent work for recency query even with weak keyword overlap", async () => {
  await withIsolatedWorkspace(async (root) => {
    await fs.mkdir(nodePath.join(root, "memory", "runs"), { recursive: true });
    await fs.writeFile(
      nodePath.join(root, "memory", "runs", "run_recent.json"),
      JSON.stringify(
        {
          id: "run_recent",
          goal: "Fix workspace snapshot persistence bug",
          input: "Persist memory/runs and memory/conversations in snapshot export",
          final_visible_assistant_text: "Applied surgical fix and validated tests.",
        },
        null,
        2
      ),
      "utf8"
    );

    const catalog = await loadToolCatalog();
    const ctx = createToolContext({ runId: "session_search_recency_fallback", autoApprove: true });
    const [out] = await runTools(
      [{ name: "session_search", arguments: { query: "last work task project topic" } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    const matches =
      (out?.result as { matches?: Array<{ path?: string; context?: string }> })?.matches || [];
    assert.ok(matches.length >= 1);
    assert.equal(matches[0]?.path, "memory/runs/run_recent.json");
    assert.match(String(matches[0]?.context || ""), /snapshot persistence bug/i);
  });
});
