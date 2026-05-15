import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import { validateRequiredArguments } from "../dist/agent-runtime/tools/argument-normalization.js";
import { createToolContext } from "../dist/agent-runtime/tools/context.js";
import {
  BUILTIN_TOOLS,
  loadToolCatalog,
  runTools,
} from "../dist/agent-runtime/tools/registry.js";

/**
 * Smoke tiers for every built-in tool:
 * - local: safe read-mostly calls in Node tests (no IPC proxy / browser host)
 * - local-setup: needs a temp workspace tree prepared in the test
 * - network-proxy: needs /api/proxy (browser adapter or dev server), not plain Node
 * - manual: gated, mutating, or approval-heavy — covered by focused tests, not matrix
 */
const SMOKE_TIERS = {
  apply_patch: "local-setup",
  artifact_present: "local",
  cron_list: "local",
  cron_register: "local",
  delete_file: "local-setup",
  edit_file: "local-setup",
  email: "network-proxy",
  file_diff: "local-setup",
  file_stat: "local-setup",
  find_files: "local-setup",
  grep: "local-setup",
  list_dir: "local",
  make_dir: "local-setup",
  memory_recall: "local",
  memory_save: "local",
  memory_search: "local",
  session_search: "local",
  move_file: "local-setup",
  multi_edit: "local-setup",
  read_file: "local-setup",
  run_shell: "local-setup",
  session_memory_append: "local",
  session_memory_list: "local",
  skill_bulk_save: "manual",
  skill_delete: "manual",
  skill_list: "local",
  skill_manage: "manual",
  skill_recall: "local-setup",
  skill_save: "manual",
  skill_view: "local-setup",
  system_info: "local",
  todo_write: "local",
  tree: "local-setup",
  vision_analyze: "network-proxy",
  web_fetch: "network-proxy",
  web_search: "network-proxy",
  write_file: "local-setup",
  youtube_transcribe: "network-proxy",
} as const;

type SmokeTier = (typeof SMOKE_TIERS)[keyof typeof SMOKE_TIERS];

const NETWORK_PROXY_ENABLED = process.env.WEBAGENT_TOOL_SMOKE_NETWORK === "1";

function relFromWorkspace(abs: string) {
  return nodePath.relative(process.cwd(), abs);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function runOne(
  name: string,
  args: Record<string, unknown>,
  catalog: Record<string, unknown>
) {
  const ctx = createToolContext({ runId: `tool_smoke_${name}`, autoApprove: true });
  const [out] = await runTools([{ name, arguments: args }], ctx, catalog);
  return out;
}

async function withIsolatedWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-tool-smoke-"));
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

test("every builtin tool has a smoke tier", () => {
  const registryNames = Object.keys(BUILTIN_TOOLS).sort();
  const tierNames = Object.keys(SMOKE_TIERS).sort();
  assert.deepEqual(tierNames, registryNames, "Update SMOKE_TIERS when adding registry tools");
});

test("tools with required schema fields reject empty arguments via runTools", async () => {
  const catalog = await loadToolCatalog();
  const ctx = createToolContext({ runId: "tool_schema_smoke" });
  for (const [name, entry] of Object.entries(BUILTIN_TOOLS)) {
    const required = Array.isArray(entry.inputSchema?.required) ? entry.inputSchema.required : [];
    if (!required.length) continue;
    const validationError = validateRequiredArguments(name, {}, entry.inputSchema);
    if (!validationError) continue;
    const [out] = await runTools([{ name, arguments: {} }], ctx, catalog);
    assert.ok(out?.error, `${name} should reject empty required args`);
    assert.match(String(out.error), /missing required field/i);
  }
});

test("local smoke tier tools execute without error", async (t) => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const stamp = Date.now();
    const memoryKey = `tool_smoke_${stamp}`;

  const cases: Array<{
    name: string;
    args: Record<string, unknown>;
    setup?: (ctx: ReturnType<typeof createToolContext>, catalog: Record<string, unknown>) => Promise<void>;
    context?: () => ReturnType<typeof createToolContext>;
    check?: (result: unknown) => void | Promise<void>;
  }> = [
    { name: "system_info", args: {}, check: (r) => assert.equal((r as { ok?: boolean }).ok, true) },
    { name: "cron_list", args: {} },
    { name: "list_dir", args: { path: "." } },
    { name: "skill_list", args: { query: "" }, check: (r) => assert.equal((r as { ok?: boolean }).ok, true) },
    { name: "session_memory_list", args: { limit: 5 } },
    {
      name: "session_memory_append",
      args: { kind: "note", text: `tool smoke ${stamp}` },
    },
    { name: "session_search", args: { query: "tool smoke", max_files: 5 } },
    { name: "memory_search", args: { query: "tool_smoke" } },
    {
      name: "memory_save",
      args: { key: memoryKey, value: { stamp } },
      check: (r) => assert.equal((r as { ok?: boolean }).ok, true),
    },
    {
      name: "memory_recall",
      args: { key: memoryKey },
      context: () => {
        const fact = {
          key: memoryKey,
          value: { stamp },
          created_at: "2026-05-12T00:00:00.000Z",
          updated_at: "2026-05-12T00:00:00.000Z",
        };
        return createToolContext({
          runId: `tool_smoke_${stamp}`,
          autoApprove: true,
          services: {
            memory: {
              setFact: async () => fact,
              getFact: async () => fact,
            },
          },
        });
      },
      check: (r) => {
        const rows = Array.isArray(r) ? (r as Array<{ key?: string }>) : [];
        assert.equal(rows[0]?.key, memoryKey);
      },
    },
    {
      name: "todo_write",
      args: { todos: [{ id: `smoke-${stamp}`, content: "matrix", status: "pending" }] },
      check: (r) => assert.equal((r as { ok?: boolean }).ok, true),
    },
    {
      name: "artifact_present",
      args: { title: "Smoke", filename: "smoke.md", markdown: "# Smoke\n" },
    },
    {
      name: "cron_register",
      args: {
        id: `smoke-cron-${stamp}`,
        tool: "system_info",
        arguments: {},
        everyMinutes: 120,
        delivery: "silent",
      },
    },
  ];

    for (const tc of cases) {
      await t.test(tc.name, async () => {
        const ctx = tc.context?.() ?? createToolContext({ runId: `tool_smoke_${stamp}`, autoApprove: true });
        if (tc.setup) await tc.setup(ctx, catalog);
        const [out] = await runTools([{ name: tc.name, arguments: tc.args }], ctx, catalog);
        assert.ok(!out?.error, `${tc.name}: ${out?.error}`);
        if (tc.check) await tc.check(out?.result);
      });
    }

    await t.test("cron_register remove after register", async () => {
      const ctx = createToolContext({ runId: `tool_smoke_cron_remove_${stamp}`, autoApprove: true });
      const removeId = `smoke-cron-remove-${stamp}`;
      const [reg] = await runTools(
        [
          {
            name: "cron_register",
            arguments: {
              id: removeId,
              tool: "system_info",
              arguments: {},
              everyMinutes: 60,
              delivery: "silent",
            },
          },
        ],
        ctx,
        catalog
      );
      assert.ok(!reg?.error, reg?.error);
      const [rem] = await runTools(
        [{ name: "cron_register", arguments: { action: "remove", id: removeId } }],
        ctx,
        catalog
      );
      assert.ok(!rem?.error, rem?.error);
      const [listed] = await runTools([{ name: "cron_list", arguments: {} }], ctx, catalog);
      const jobs = (listed?.result as { jobs?: Array<{ id?: string }> })?.jobs || [];
      assert.ok(!jobs.some((j) => j.id === removeId));
    });
  });
});

test("local-setup smoke tier tools execute on an isolated workspace tree", async (t) => {
  const catalog = await loadToolCatalog();
  const root = nodePath.join(process.cwd(), "tmp", `tool-smoke-${Date.now()}`);
  const relRoot = relFromWorkspace(root);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const setupCases: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "make_dir", args: { path: `${relRoot}/nested` } },
    {
      name: "write_file",
      args: { path: `${relRoot}/nested/file.txt`, content: "alpha\nbeta\n" },
    },
    { name: "read_file", args: { path: `${relRoot}/nested/file.txt` } },
    { name: "file_stat", args: { path: `${relRoot}/nested/file.txt` } },
    { name: "list_dir", args: { path: relRoot, recursive: true } },
    { name: "tree", args: { path: relRoot, maxDepth: 3 } },
    { name: "find_files", args: { pattern: "*.txt", root: relRoot } },
    { name: "grep", args: { pattern: "alpha", root: relRoot } },
    {
      name: "edit_file",
      args: { path: `${relRoot}/nested/file.txt`, find: "alpha", replace: "gamma" },
    },
    {
      name: "multi_edit",
      args: {
        path: `${relRoot}/nested/file.txt`,
        edits: JSON.stringify([{ find: "beta", replace: "delta" }]),
      },
    },
    {
      name: "apply_patch",
      args: {
        patch: [
          "*** Begin Patch",
          `*** Add File: ${relRoot}/patched.txt`,
          "+patched",
          "*** End Patch",
        ].join("\n"),
      },
    },
    {
      name: "file_diff",
      args: {
        path_a: `${relRoot}/nested/file.txt`,
        path_b: `${relRoot}/patched.txt`,
      },
    },
    {
      name: "move_file",
      args: {
        from: `${relRoot}/patched.txt`,
        to: `${relRoot}/moved/patched.txt`,
      },
    },
    { name: "delete_file", args: { path: `${relRoot}/moved/patched.txt` } },
    { name: "run_shell", args: { command: "printf matrix-ok", cwd: relRoot, timeout_ms: 5000 } },
  ];

  for (const tc of setupCases) {
    await t.test(tc.name, async () => {
      const out = await runOne(tc.name, tc.args, catalog);
      assert.ok(!out?.error, `${tc.name}: ${out?.error}`);
    });
  }

  await t.test("run_shell background completion events", async () => {
    const memoryCalls = {
      jobs: [] as unknown[],
      logs: [] as unknown[],
      events: [] as unknown[],
    };
    const memoryStub = {
      async upsertJob(payload: unknown) {
        memoryCalls.jobs.push(payload);
      },
      async appendJobLog(jobId: string, payload: unknown) {
        memoryCalls.logs.push({ jobId, payload });
        return { job_id: jobId, bytes: JSON.stringify(payload).length, last_log_offset: 1 };
      },
      async enqueueJobEvent(payload: unknown) {
        memoryCalls.events.push(payload);
      },
    };
    const ctx = createToolContext({
      runId: `tool_smoke_bg_${Date.now()}`,
      autoApprove: true,
      services: { memory: memoryStub },
    });
    const [out] = await runTools(
      [
        {
          name: "run_shell",
          arguments: {
            command: "printf match-ready",
            cwd: relRoot,
            background: true,
            watch_patterns: ["match-ready"],
            notify_on_complete: true,
          },
        },
      ],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    const result = out?.result as { background?: boolean; job_id?: string };
    assert.equal(result?.background, true);
    assert.ok(result?.job_id);
    const completed = await waitFor(() =>
      memoryCalls.events.some(
        (event) => (event as { eventType?: string })?.eventType === "completed"
      )
    );
    assert.equal(completed, true);
    assert.ok(memoryCalls.logs.length > 0);
  });

  await t.test("skill_view when skills exist", async () => {
    const listed = await runOne("skill_list", { query: "" }, catalog);
    assert.ok(!listed?.error, listed?.error);
    const skills = (listed?.result as { skills?: Array<{ name?: string }> })?.skills || [];
    if (!skills.length) {
      t.skip("no skills in workspace");
      return;
    }
    const name = String(skills[0]?.name || "").trim();
    assert.ok(name, "skill_list returned unnamed skill");
    const out = await runOne("skill_view", { name }, catalog);
    assert.ok(!out?.error, out?.error);
  });

  await t.test("skill_recall when skills exist", async () => {
    const listed = await runOne("skill_list", { query: "" }, catalog);
    const skills = (listed?.result as { skills?: Array<{ name?: string }> })?.skills || [];
    if (!skills.length) {
      t.skip("no skills in workspace");
      return;
    }
    const name = String(skills[0]?.name || "").trim();
    const out = await runOne("skill_recall", { name }, catalog);
    assert.ok(!out?.error, out?.error);
  });
});

test("network-proxy tier is opt-in via WEBAGENT_TOOL_SMOKE_NETWORK=1", async (t) => {
  const catalog = await loadToolCatalog();
  const networkTools = Object.entries(SMOKE_TIERS)
    .filter(([, tier]) => tier === "network-proxy")
    .map(([name]) => name);

  if (!NETWORK_PROXY_ENABLED) {
    t.diagnostic(
      `Skipping proxy-backed tools (set WEBAGENT_TOOL_SMOKE_NETWORK=1): ${networkTools.join(", ")}`
    );
    return;
  }

  const cases: Array<{ name: string; args: Record<string, unknown> }> = [
    { name: "web_search", args: { query: "web agent smoke test" } },
    { name: "web_fetch", args: { url: "https://example.com" } },
    {
      name: "youtube_transcribe",
      args: { url: "https://www.youtube.com/watch?v=pl90LATQlHI" },
    },
  ];

  for (const tc of cases) {
    await t.test(tc.name, async () => {
      const out = await runOne(tc.name, tc.args, catalog);
      assert.ok(!out?.error, `${tc.name}: ${out?.error}`);
    });
  }
});

test("smoke tier manifest documents manual and proxy-only tools", () => {
  const manual = Object.entries(SMOKE_TIERS)
    .filter(([, tier]) => tier === "manual")
    .map(([name]) => name)
    .sort();
  const proxy = Object.entries(SMOKE_TIERS)
    .filter(([, tier]) => tier === "network-proxy")
    .map(([name]) => name)
    .sort();
  assert.deepEqual(manual, [
    "skill_bulk_save",
    "skill_delete",
    "skill_manage",
    "skill_save",
  ]);
  assert.deepEqual(proxy, ["email", "vision_analyze", "web_fetch", "web_search", "youtube_transcribe"]);
});
