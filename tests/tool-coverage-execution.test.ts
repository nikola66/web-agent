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
import { audioAnalyzeTool } from "../dist/agent-runtime/tools/audio-tools.js";
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

function makeStoredZip(files: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const data = Buffer.from(file.content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }
  const cdirSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

test("each builtin tool has a documented execution test path", () => {
  const covered = new Set([
    "archive_list",
    "apply_patch",
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
  ]);
  assert.deepEqual([...covered].sort(), Object.keys(BUILTIN_TOOLS).sort());
});

test("composio_status reports missing configuration without network", async () => {
  const catalog = await loadToolCatalog();
  const out = await runOne("composio_status", {}, catalog, { env: {} });
  assert.ok(!out?.error, out?.error);
  const result = out?.result as { configured?: boolean; missing?: string; allowed_actions?: unknown[] };
  assert.equal(result.configured, false);
  assert.equal(result.missing, "WEBAGENT_COMPOSIO_API_KEY");
  assert.ok(result.setup?.steps?.length);
  assert.match(String(result.message), /Settings/i);
  assert.ok((result.allowed_actions?.length ?? 0) >= 5);
});

test("archive tools honor explicit archive_path and extract skill archives", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const root = process.env.WEBAGENT_WORKSPACE_ROOT || "";
    await fs.mkdir(nodePath.join(root, "work"), { recursive: true });
    await fs.writeFile(
      nodePath.join(root, "work", "directus-skill.zip"),
      makeStoredZip([
        {
          name: "directus-5lang-blog-publisher/SKILL.md",
          content: "---\nname: directus-5lang-blog-publisher\ndescription: Directus publisher\n---\n\n## Procedure\n\n1. Publish.\n",
        },
        {
          name: "directus-5lang-blog-publisher/templates/publish-5lang.py",
          content: "print('publish')\n",
        },
        {
          name: "directus-5lang-blog-publisher/references/directus-api.md",
          content: "# Directus API\n",
        },
      ])
    );

    const listed = await runOne("archive_list", { archive_path: "work/directus-skill.zip" }, catalog);
    assert.ok(!listed?.error, listed?.error);
    assert.equal((listed?.result as { totalEntries?: number })?.totalEntries, 3);

    const extracted = await runOne(
      "extract_archive",
      { archive_path: "work/directus-skill.zip", destination: "work/directus-skill-extracted" },
      catalog
    );
    assert.ok(!extracted?.error, extracted?.error);
    assert.equal((extracted?.result as { extractedFiles?: number })?.extractedFiles, 3);
    const skill = await fs.readFile(
      nodePath.join(root, "work", "directus-skill-extracted", "directus-5lang-blog-publisher", "SKILL.md"),
      "utf8"
    );
    assert.match(skill, /directus-5lang-blog-publisher/);
  });
});

test("composio_connect discovers auth configs and links automatically when one exists", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          data: [
            { id: "auth_google_calendar_1", toolkit: { slug: "GOOGLECALENDAR" }, name: "Google Calendar" },
          ],
        }),
        { status: 200 }
      );
    }
    if (calls.length === 2) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    assert.equal(String(url).endsWith("/connected_accounts/link"), true);
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "cmp_test");
    return new Response(JSON.stringify({ redirect_url: "https://connect.example/link" }), { status: 200 });
  };
  try {
    const out = await runOne(
      "composio_connect",
      { app: "google_calendar", user_id: "user_1" },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!out?.error, out?.error);
    const result = out?.result as { redirect_url?: string; selected_connected_account?: { id?: string } };
    assert.equal(result.redirect_url, "https://connect.example/link");
    assert.equal(result.selected_connected_account, undefined);
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_connect lists connected account choices when multiple accounts exist", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        data: [
          { id: "acct_1", toolkit: { slug: "GOOGLECALENDAR" }, status: "ACTIVE", name: "Personal Calendar" },
          { id: "acct_2", toolkit: { slug: "GOOGLECALENDAR" }, status: "ACTIVE", name: "Work Calendar" },
        ],
      }),
      { status: 200 }
    );
  };
  try {
    const out = await runOne(
      "composio_connect",
      { app: "google_calendar", user_id: "user_1" },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!out?.error, out?.error);
    const result = out?.result as { needs_choice?: boolean; connected_accounts?: Array<{ id?: string; name?: string }> };
    assert.equal(result.needs_choice, true);
    assert.equal(result.connected_accounts?.length, 2);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_connect creates hosted auth link through configured API", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  let seenUrl = "";
  let seenBody: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init?.body || "{}"));
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "cmp_test");
    return new Response(JSON.stringify({ redirect_url: "https://connect.example/link" }), { status: 200 });
  };
  try {
    const out = await runOne(
      "composio_connect",
      { app: "gmail", auth_config_id: "ac_123", user_id: "user_1" },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!out?.error, out?.error);
    assert.match(seenUrl, /\/connected_accounts\/link$/);
    assert.deepEqual(seenBody, { user_id: "user_1", auth_config_id: "ac_123" });
    assert.equal((out?.result as { redirect_url?: string })?.redirect_url, "https://connect.example/link");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_action rejects non-allowlisted actions", async () => {
  const catalog = await loadToolCatalog();
  const out = await runOne(
    "composio_action",
    { action: "gmail_delete_everything", args: {} },
    catalog,
    { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
  );
  assert.ok(out?.error, "expected allowlist rejection");
  assert.match(String(out.error), /Unsupported Composio marketing action/);
});

const GMAIL_ACCOUNT_LIST_RESPONSE = JSON.stringify({
  data: [
    {
      id: "ca_gmail_1",
      toolkit: { slug: "GMAIL" },
      status: "ACTIVE",
      name: "Primary Gmail",
      user_id: "user_1",
    },
  ],
});

const CALENDAR_ACCOUNT_LIST_RESPONSE = JSON.stringify({
  data: [
    {
      id: "ca_cal_1",
      toolkit: { slug: "GOOGLECALENDAR" },
      status: "ACTIVE",
      name: "Primary Calendar",
      user_id: "user_1",
    },
  ],
});

test("composio_action executes a curated marketing action and logs it", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const originalFetch = globalThis.fetch;
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    let call = 0;
    globalThis.fetch = async (url, init) => {
      call += 1;
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "cmp_test");
      if (call === 1) {
        return new Response(GMAIL_ACCOUNT_LIST_RESPONSE, { status: 200 });
      }
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({ data: { draft_id: "d1" }, successful: true }), { status: 200 });
    };
    try {
      const out = await runOne(
        "composio_action",
        {
          action: "gmail_create_draft",
          args: { to: "lead@example.com", subject: "Intro", body: "Hello" },
          user_id: "user_1",
        },
        catalog,
        { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
      );
      assert.ok(!out?.error, out?.error);
      assert.match(seenUrl, /\/tools\/execute\/GMAIL_CREATE_EMAIL_DRAFT$/);
      assert.equal(seenBody.connected_account_id, "ca_gmail_1");
      assert.equal(seenBody.user_id, "user_1");
      assert.deepEqual(seenBody.arguments, { to: "lead@example.com", subject: "Intro", body: "Hello" });
      const result = out?.result as { ok?: boolean; action?: string; approval_required?: boolean };
      assert.equal(result.ok, true);
      assert.equal(result.action, "gmail_create_draft");
      assert.equal(result.approval_required, false);
      const logPath = nodePath.join(process.env.WEBAGENT_WORKSPACE_ROOT || "", ".webagent/composio-actions.jsonl");
      const log = await fs.readFile(logPath, "utf8");
      assert.match(log, /gmail_create_draft/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("composio_action does not gate read actions", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  let askCalled = false;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return new Response(GMAIL_ACCOUNT_LIST_RESPONSE, { status: 200 });
    return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
  };
  try {
    const ctx = createToolContext({
      runId: "tool_coverage_composio_read",
      autoApprove: false,
      ask: async () => {
        askCalled = true;
        return false;
      },
      env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" },
    });
    const [out] = await runTools(
      [{ name: "composio_action", arguments: { action: "gmail_fetch_emails", args: { query: "newer_than:1d" } } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    assert.equal(askCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_action gates outbound send actions", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  let askCalled = false;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return new Response(GMAIL_ACCOUNT_LIST_RESPONSE, { status: 200 });
    return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
  };
  try {
    const ctx = createToolContext({
      runId: "tool_coverage_composio_send",
      autoApprove: false,
      ask: async () => {
        askCalled = true;
        return true;
      },
      env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" },
    });
    const [out] = await runTools(
      [{ name: "composio_action", arguments: { action: "gmail_send_email", args: { recipient_email: "lead@example.com", subject: "Intro" } } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    assert.equal(askCalled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_action resolves a selected connected account id before execute", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let seenBody: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "ca_acct_1",
              toolkit: { slug: "GMAIL" },
              status: "ACTIVE",
              name: "Primary Gmail",
              user_id: "user_1",
            },
          ],
        }),
        { status: 200 }
      );
    }
    seenBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
  };
  try {
    const out = await runOne(
      "composio_action",
      {
        action: "gmail_fetch_emails",
        args: { query: "newer_than:1d" },
        connected_account_id: "ca_acct_1",
        user_id: "user_1",
      },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!out?.error, out?.error);
    assert.equal(calls.length, 2);
    assert.equal(seenBody.connected_account_id, "ca_acct_1");
    assert.equal(seenBody.user_id, "user_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_action covers calendar read and write slugs", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (url) => {
    const sUrl = String(url);
    if (sUrl.includes("/connected_accounts")) {
      return new Response(CALENDAR_ACCOUNT_LIST_RESPONSE, { status: 200 });
    }
    seen.push(sUrl);
    return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
  };
  try {
    const readOut = await runOne(
      "composio_action",
      { action: "google_calendar_list_events", args: { calendar_id: "primary", time_min: "2026-05-01T00:00:00Z" } },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!readOut?.error, readOut?.error);
    const writeOut = await runOne(
      "composio_action",
      { action: "google_calendar_create_event", args: { calendar_id: "primary", summary: "Standup", start_datetime: "2026-05-01T10:00:00Z", end_datetime: "2026-05-01T10:15:00Z" } },
      catalog,
      { env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" } }
    );
    assert.ok(!writeOut?.error, writeOut?.error);
    assert.equal(seen[0].includes("/tools/execute/GOOGLECALENDAR_EVENTS_LIST"), true);
    assert.equal(seen[1].includes("/tools/execute/GOOGLECALENDAR_CREATE_EVENT"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const LINKEDIN_ACCOUNT_LIST_RESPONSE = JSON.stringify({
  data: [
    {
      id: "ca_li_1",
      toolkit: { slug: "LINKEDIN" },
      status: "ACTIVE",
      name: "Primary LinkedIn",
      user_id: "user_1",
    },
  ],
});

const LINKEDIN_MY_INFO_RESPONSE = JSON.stringify({
  successful: true,
  data: { id: "abc123", localizedFirstName: "Test" },
});

test("composio_action linkedin url share normalizes args and sends toolkit version", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const seenBodies: Record<string, unknown>[] = [];
  let call = 0;
  globalThis.fetch = async (url, init) => {
    call += 1;
    const sUrl = String(url);
    if (sUrl.includes("/connected_accounts")) {
      return new Response(LINKEDIN_ACCOUNT_LIST_RESPONSE, { status: 200 });
    }
    seenBodies.push(JSON.parse(String(init?.body || "{}")));
    if (sUrl.includes("/tools/execute/LINKEDIN_GET_MY_INFO")) {
      return new Response(LINKEDIN_MY_INFO_RESPONSE, { status: 200 });
    }
    return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
  };
  try {
    const ctx = createToolContext({
      runId: "tool_coverage_composio_linkedin",
      autoApprove: true,
      env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" },
    });
    const [out] = await runTools(
      [
        {
          name: "composio_action",
          arguments: {
            action: "linkedin_create_article_or_url_share",
            args: {
              text: "Security incident recap",
              url: "https://composio.dev/blog/composio-may-2026-security-incident",
            },
            user_id: "user_1",
          },
        },
      ],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    assert.equal(seenBodies.length, 2);
    assert.equal(seenBodies[0].version, "latest");
    assert.equal(seenBodies[1].version, "latest");
    const executeBody = seenBodies[1];
    const args = executeBody.arguments as Record<string, unknown>;
    assert.equal(args.author, "urn:li:person:abc123");
    assert.ok(args.specificContent);
    assert.equal((executeBody.connected_account_id as string) || "", "ca_li_1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("composio_action linkedin url share falls back to create post on 404", async () => {
  const catalog = await loadToolCatalog();
  const originalFetch = globalThis.fetch;
  const executeUrls: string[] = [];
  let call = 0;
  globalThis.fetch = async (url, init) => {
    call += 1;
    const sUrl = String(url);
    if (sUrl.includes("/connected_accounts")) {
      return new Response(LINKEDIN_ACCOUNT_LIST_RESPONSE, { status: 200 });
    }
    if (sUrl.includes("/tools/execute/")) {
      executeUrls.push(sUrl);
      if (sUrl.includes("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE")) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      }
      return new Response(JSON.stringify({ successful: true, data: { ok: true } }), { status: 200 });
    }
    if (sUrl.includes("/tools?")) {
      return new Response(JSON.stringify({ items: [{ slug: "LINKEDIN_CREATE_LINKED_IN_POST" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ successful: true, data: { id: "abc123" } }), { status: 200 });
  };
  try {
    const ctx = createToolContext({
      runId: "tool_coverage_composio_linkedin_fallback",
      autoApprove: true,
      env: { WEBAGENT_COMPOSIO_API_KEY: "cmp_test" },
    });
    const [out] = await runTools(
      [
        {
          name: "composio_action",
          arguments: {
            action: "linkedin_create_article_or_url_share",
            args: {
              author: "urn:li:person:abc123",
              text: "Fallback post",
              url: "https://example.com/article",
            },
            user_id: "user_1",
          },
        },
      ],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    assert.ok(executeUrls.some((u) => u.includes("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE")));
    assert.ok(executeUrls.some((u) => u.includes("LINKEDIN_CREATE_LINKED_IN_POST")));
    const result = out?.result as { composio_action_id?: string };
    assert.equal(result.composio_action_id, "LINKEDIN_CREATE_LINKED_IN_POST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wiki_setup and wiki_search run on isolated workspace", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const vaultRoot = `tmp/wiki-tool-coverage-${Date.now()}`;
    const setup = await runOne("wiki_setup", { root_path: vaultRoot }, catalog);
    assert.ok(!setup?.error, setup?.error);
    const created = (setup?.result as { files_written?: string[] })?.files_written || [];
    assert.ok(created.length >= 1);
    const search = await runOne(
      "wiki_search",
      { query: "PARA", root_path: vaultRoot, limit: 5 },
      catalog
    );
    assert.ok(!search?.error, search?.error);
    const matches = (search?.result as { matches?: unknown[] })?.matches || [];
    assert.ok(matches.length >= 1);
  });
});

test("wiki_sync updates wiki index when facts exist", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const stubFacts = [
      {
        key: `coverage_wiki_${Date.now()}`,
        value: { note: "vault projection" },
        created_at: "2026-05-12T00:00:00.000Z",
        updated_at: "2026-05-12T00:00:00.000Z",
      },
    ];
    const ctx = createToolContext({
      runId: `tool_coverage_wiki_sync_${Date.now()}`,
      autoApprove: true,
      services: {
        memory: {
          getAllFacts: async () => stubFacts,
          getPromotableLearnings: async () => [],
        },
      },
    });
    const vaultRoot = `tmp/wiki-sync-coverage-${Date.now()}`;
    let [out] = await runTools([{ name: "wiki_setup", arguments: { root_path: vaultRoot } }], ctx, catalog);
    assert.ok(!out?.error, out?.error);
    [out] = await runTools(
      [{ name: "wiki_sync", arguments: { root_path: vaultRoot, scope: "facts", max_items: 10 } }],
      ctx,
      catalog
    );
    assert.ok(!out?.error, out?.error);
    const counts = (out?.result as { counts?: { facts?: number } })?.counts;
    assert.ok((counts?.facts ?? 0) >= 1);
  });
});

test("wiki_sync resolves root_path with stray wrapping quotes", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const stubFacts = [
      {
        key: `coverage_wiki_quote_${Date.now()}`,
        value: { note: "quoted path" },
        created_at: "2026-05-12T00:00:00.000Z",
        updated_at: "2026-05-12T00:00:00.000Z",
      },
    ];
    const ctx = createToolContext({
      runId: `tool_coverage_wiki_sync_quotes_${Date.now()}`,
      autoApprove: true,
      services: {
        memory: {
          getAllFacts: async () => stubFacts,
          getPromotableLearnings: async () => [],
        },
      },
    });
    const vaultRoot = `tmp/wiki-sync-quotes-${Date.now()}`;
    let [out] = await runTools([{ name: "wiki_setup", arguments: { root_path: vaultRoot } }], ctx, catalog);
    assert.ok(!out?.error, out?.error);
    [out] = await runTools(
      [
        {
          name: "wiki_sync",
          arguments: {
            root_path: `"${vaultRoot}"`,
            scope: "facts",
            max_items: 10,
          },
        },
      ],
      ctx,
      catalog
    );
    assert.ok(!out?.error, String(out?.error));
  });
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

test("memory_forget deletes a saved fact by exact key", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const key = `coverage_forget_${Date.now()}`;
    const fact = {
      key,
      value: { stale: true },
      scope: "project",
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:00:00.000Z",
    };
    const ctx = createToolContext({
      runId: `tool_coverage_memory_forget_${Date.now()}`,
      autoApprove: true,
      services: {
        memory: {
          deleteFact: async () => ({ key, deleted: true, previous: fact }),
        },
      },
    });
    const [forgotten] = await runTools([{ name: "memory_forget", arguments: { key } }], ctx, catalog);
    assert.ok(!forgotten?.error, forgotten?.error);
    assert.equal((forgotten?.result as { deleted?: boolean })?.deleted, true);
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
    const regResult = registered?.result as {
      success?: boolean;
      ok?: boolean;
      message?: string;
      job?: { id?: string };
      count?: number;
    };
    assert.equal(regResult.success, true);
    assert.equal(regResult.ok, true);
    assert.match(String(regResult.message || ""), new RegExp(id));
    assert.equal(regResult.job?.id, id);
    const listResult = listed?.result as {
      success?: boolean;
      count?: number;
      jobs?: unknown[];
      message?: string;
    };
    assert.equal(listResult.success, true);
    assert.equal(listResult.count, listResult.jobs?.length);
    assert.match(String(listResult.message || ""), /cron job/i);
  });
});

test("cron_register action remove deletes job from store", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-remove-${Date.now()}`;
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
    const removed = await runOne("cron_register", { action: "remove", id }, catalog);
    assert.ok(!removed?.error, removed?.error);
    assert.equal((removed?.result as { removed?: boolean })?.removed, true);
    const listed = await runOne("cron_list", {}, catalog);
    const jobs = (listed?.result as { jobs?: Array<{ id?: string }> })?.jobs || [];
    assert.ok(!jobs.some((entry) => entry.id === id), "removed job should not appear in cron_list");
  });
});

test("cron_register action remove errors on unknown id", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-missing-${Date.now()}`;
    const out = await runOne("cron_register", { action: "remove", id }, catalog);
    assert.ok(out?.error, "expected error for unknown id");
    assert.match(String(out.error), /unknown id/i);
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

test("cron_register accepts email as a step tool when send args are present", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-email-step-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 1440,
        delivery: "terminal",
        steps: [
          { tool: "web_search", arguments: { query: "web agent github stars", page: 0 } },
          {
            tool: "email",
            to: "lead@example.com",
            cc: "hello@aratech.ae",
            subject: "Web Agent — worth a star?",
            text: "Personalized body here.",
          },
          {
            tool: "write_file",
            arguments: {
              path: "work/outreach/cron-log.md",
              content: "Logged outreach run.",
            },
          },
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
          steps?: Array<{ tool?: string; arguments?: Record<string, unknown> }>;
        }>;
      })?.jobs || [];
    const job = jobs.find((entry) => entry.id === id);
    assert.equal(job?.steps?.[1]?.tool, "email");
    assert.equal(job?.steps?.[1]?.arguments?.to, "lead@example.com");
    assert.equal(job?.steps?.[1]?.arguments?.cc, "hello@aratech.ae");
  });
});

test("cron_register still rejects bare email delivery name without send args", async () => {
  await withIsolatedWorkspace(async () => {
    const catalog = await loadToolCatalog();
    const id = `coverage-cron-email-misname-${Date.now()}`;
    const registered = await runOne(
      "cron_register",
      {
        id,
        everyMinutes: 60,
        delivery: "terminal",
        steps: [{ tool: "email" }],
      },
      catalog
    );
    assert.ok(registered?.error);
    assert.match(String(registered?.error), /delivery mode/);
    assert.match(String(registered?.error), /step tool/);
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

test("audio_analyze rejects missing audio payloads before STT IPC", async () => {
  await assert.rejects(
    audioAnalyzeTool({ question: "What did they say?" }, { env: process.env }),
    /workspace_relative_audio_path|audio_data_url|audio_url|fetch_url/
  );
});

test("audio_analyze rejects workspace audio paths outside the allowed roots", async () => {
  await assert.rejects(
    audioAnalyzeTool(
      { workspace_relative_audio_path: "notes/clip.ogg" },
      { env: process.env, cwd: process.cwd() }
    ),
    /uploads\/|voice-inbox/
  );
});
