import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import { createToolContext as createToolContextRaw } from "../dist/agent-runtime/tools/context.js";
import type { CreateToolContextInput } from "../src/agent/runtime/tools/context.js";

const createToolContext = createToolContextRaw as (
  input?: CreateToolContextInput
) => ReturnType<typeof createToolContextRaw>;
import { emailTool } from "../dist/agent-runtime/tools/email-tools.js";
import { visionAnalyzeTool } from "../dist/agent-runtime/tools/vision-tools.js";
import {
  BUILTIN_TOOLS,
  loadToolCatalog,
  runTools,
} from "../dist/agent-runtime/tools/registry.js";

async function runOne(
  name: string,
  args: Record<string, unknown>,
  catalog: Record<string, unknown>,
  ctxOptions: Record<string, unknown> = {}
) {
  const ctx = createToolContext({ runId: `tool_coverage_${name}`, autoApprove: true, ...ctxOptions });
  const [out] = await runTools([{ name, arguments: args }], ctx, catalog);
  return out;
}

async function withIsolatedWorkspace<T>(run: () => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-tool-coverage-"));
  const previousWorkspaceRoot = process.env.WEBAGENT_WORKSPACE_ROOT;
  const previousMemoryRoot = process.env.WEBAGENT_MEMORY_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  process.env.WEBAGENT_MEMORY_ROOT = nodePath.join(root, "memory");
  try {
    return await run();
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
    if (previousMemoryRoot === undefined) delete process.env.WEBAGENT_MEMORY_ROOT;
    else process.env.WEBAGENT_MEMORY_ROOT = previousMemoryRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("each builtin tool has a documented execution test path", () => {
  const covered = new Set([
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
  ]);
  assert.deepEqual([...covered].sort(), Object.keys(BUILTIN_TOOLS).sort());
});

test("memory_recall returns a saved fact by exact key", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const key = `coverage_recall_${Date.now()}`;
    const fact = {
      key,
      value: { mode: "aurora" },
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:00:00.000Z",
    };
    const ctx = createToolContext({
      runId: `tool_coverage_memory_${Date.now()}`,
      autoApprove: true,
      services: {
        memory: {
          setFact: async () => fact,
          getFact: async () => fact,
        },
      },
    });
    const [saved] = await runTools(
      [{ name: "memory_save", arguments: { key, value: fact.value } }],
      ctx,
      catalog
    );
    assert.ok(!saved?.error, saved?.error);
    const [recalled] = await runTools([{ name: "memory_recall", arguments: { key } }], ctx, catalog);
    assert.ok(!recalled?.error, recalled?.error);
    const rows = Array.isArray(recalled?.result)
      ? (recalled.result as Array<{ key?: string; value?: unknown }>)
      : [];
    assert.equal(rows[0]?.key, key);
    assert.deepEqual(rows[0]?.value, { mode: "aurora" });
  });
});

test("cron_register validates tool names and persists jobs", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        tool: "system_info",
        arguments: {},
        everyMinutes: 45,
        delivery: "silent",
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    assert.ok(!listed?.error, listed?.error);
    const jobs = (listed?.result as { jobs?: Array<{ id?: string; tool?: string }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.ok(job, "registered cron job should appear in cron_list");
    assert.equal(job.tool, "system_info");
  });
});

test("cron_register lifts top-level root tool args into arguments", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const shellId = `coverage-cron-root-shell-${Date.now()}`;
    const searchId = `coverage-cron-root-search-${Date.now()}`;
    const shellRegistered = await runOne(
      "cron_register",
      {
        id: shellId,
        tool: "run_shell",
        command: "node -e \"console.log('hydrate')\"",
        everyMinutes: 120,
        delivery: "terminal",
      },
      catalog
    );
    assert.ok(!shellRegistered?.error, shellRegistered?.error);
    const searchRegistered = await runOne(
      "cron_register",
      {
        id: searchId,
        tool: "web_search",
        query: "latest 3-bit LLM models",
        page: 0,
        everyMinutes: 1440,
        delivery: "terminal",
      },
      catalog
    );
    assert.ok(!searchRegistered?.error, searchRegistered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as {
        jobs?: Array<{
          id?: string;
          arguments?: { command?: string; query?: string; page?: number };
        }>;
      })?.jobs || [];
    const shellJob = jobs.find((entry) => entry.id === shellId);
    const searchJob = jobs.find((entry) => entry.id === searchId);
    assert.equal(shellJob?.arguments?.command, "node -e \"console.log('hydrate')\"");
    assert.equal(searchJob?.arguments?.query, "latest 3-bit LLM models");
    assert.equal(searchJob?.arguments?.page, 0);
  });
});

test("cron_register persists weekly everyMinutes (no 24h clamp)", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-weekly-${Date.now()}`;
    const everyMinutes = 7 * 24 * 60;
    const registered = await runOne(
      "cron_register",
      {
        id,
        tool: "system_info",
        arguments: {},
        everyMinutes,
        delivery: "silent",
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    assert.equal(
      (registered?.result as { everyMinutes?: number })?.everyMinutes,
      everyMinutes,
      "tool result should echo persisted everyMinutes"
    );
    const listed = await runOne("cron_list", {}, catalog);
    assert.ok(!listed?.error, listed?.error);
    const jobs = (listed?.result as { jobs?: Array<{ id?: string; everyMinutes?: number }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.ok(job, "weekly cron job should appear in cron_list");
    assert.equal(job.everyMinutes, everyMinutes);
  });
});

test("cron_register accepts steps that use action instead of tool", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-action-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 45,
        delivery: "silent",
        steps: [{ action: "system_info", arguments: {} }],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    assert.ok(!listed?.error, listed?.error);
    const jobs =
      (listed?.result as { jobs?: Array<{ id?: string; steps?: Array<{ tool?: string }> }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.ok(job, "registered cron job should appear in cron_list");
    assert.equal(job.steps?.[0]?.tool, "system_info");
  });
});

test("cron_register lifts top-level step args into arguments", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-step-top-level-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 60,
        delivery: "terminal",
        steps: [
          { tool: "run_shell", command: "node -e \"console.log('hydrate')\"" },
          { tool: "web_search", query: "latest 3-bit LLM models", page: 1 },
        ],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as {
        jobs?: Array<{
          id?: string;
          steps?: Array<{ arguments?: { command?: string; query?: string; page?: number } }>;
        }>;
      })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[0]?.arguments?.command, "node -e \"console.log('hydrate')\"");
    assert.equal(job?.steps?.[1]?.arguments?.query, "latest 3-bit LLM models");
    assert.equal(job?.steps?.[1]?.arguments?.page, 1);
  });
});

test("cron_register normalizes string steps to run_shell", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-str-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 45,
        delivery: "silent",
        steps: ["printf 'hydrate'"],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as { jobs?: Array<{ id?: string; steps?: Array<{ tool?: string }> }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[0]?.tool, "run_shell");
  });
});

test("cron_register normalizes delivery name in step action plus text to run_shell", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-term-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 60,
        delivery: "terminal",
        steps: [{ name: "notify", action: "terminal", text: "Time to drink water" }],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as { jobs?: Array<{ id?: string; steps?: Array<{ tool?: string; arguments?: { command?: string } }> }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[0]?.tool, "run_shell");
    assert.match(String(job?.steps?.[0]?.arguments?.command || ""), /Time to drink water/);
  });
});

test("cron_register infers web_search when step has only arguments.query", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-args-query-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 1440,
        delivery: "terminal",
        steps: [{ arguments: { query: "latest trending AI news headlines" } }],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as { jobs?: Array<{ id?: string; steps?: Array<{ tool?: string; arguments?: { query?: string } }> }> })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[0]?.tool, "web_search");
    assert.equal(
      job?.steps?.[0]?.arguments?.query,
      "latest trending AI news headlines"
    );
  });
});

test("cron_register preserves existing root arguments on same-tool schedule updates", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-preserve-${Date.now()}`;
    const created = await runOne(
      "cron_register",
      {
        id,
        tool: "run_shell",
        command: "node -e \"console.log('hydrate')\"",
        everyMinutes: 120,
        delivery: "terminal",
      },
      catalog
    );
    assert.ok(!created?.error, created?.error);
    const updated = await runOne(
      "cron_register",
      {
        id,
        tool: "run_shell",
        everyMinutes: 240,
        delivery: "silent",
      },
      catalog
    );
    assert.ok(!updated?.error, updated?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as {
        jobs?: Array<{ id?: string; everyMinutes?: number; delivery?: string; arguments?: { command?: string } }>;
      })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.everyMinutes, 240);
    assert.equal(job?.delivery, "silent");
    assert.equal(job?.arguments?.command, "node -e \"console.log('hydrate')\"");
  });
});

test("cron_register prefers nested arguments over duplicate top-level step args", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-step-precedence-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 60,
        delivery: "terminal",
        steps: [
          {
            tool: "run_shell",
            command: "node -e \"console.log('wrong')\"",
            arguments: { command: "node -e \"console.log('right')\"" },
          },
        ],
      },
      catalog
    );
    assert.ok(!registered?.error, registered?.error);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs =
      (listed?.result as {
        jobs?: Array<{ id?: string; steps?: Array<{ arguments?: { command?: string } }> }>;
      })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[0]?.arguments?.command, "node -e \"console.log('right')\"");
  });
});

test("email self_test reports configuration without sending mail", async () => {
  const ctx = createToolContext({ runId: "tool_coverage_email", autoApprove: true });
  const out = await emailTool({ action: "self_test" }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.send?.provider, "resend");
  assert.equal(typeof out.send?.configured, "boolean");
});

test("vision_analyze rejects missing image payloads before provider calls", async () => {
  await assert.rejects(
    visionAnalyzeTool({ question: "What is in this image?" }, { env: process.env }),
    /workspace_relative_image_path|image_data_url|image_url|fetch_url/
  );
});

test("vision_analyze rejects workspace image paths outside uploads before provider calls", async () => {
  await assert.rejects(
    visionAnalyzeTool(
      { workspace_relative_image_path: "notes/screenshot.png" },
      { env: process.env, cwd: process.cwd() }
    ),
    /uploads\//
  );
});
