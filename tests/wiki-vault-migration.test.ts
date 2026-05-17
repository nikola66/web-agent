import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import { createToolContext } from "../dist/agent-runtime/tools/context.js";
import { wikiSearchTool, wikiSetupTool } from "../dist/agent-runtime/tools/wiki-tools.js";

async function withIsolatedWorkspaceRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-wiki-"));
  const previousWorkspaceRoot = process.env.WEBAGENT_WORKSPACE_ROOT;
  process.env.WEBAGENT_WORKSPACE_ROOT = root;
  try {
    return await run(root);
  } finally {
    if (previousWorkspaceRoot === undefined) delete process.env.WEBAGENT_WORKSPACE_ROOT;
    else process.env.WEBAGENT_WORKSPACE_ROOT = previousWorkspaceRoot;
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("implicit wiki default migrates legacy knowledge-vault to .webagent/knowledge-vault", async () => {
  await withIsolatedWorkspaceRoot(async (root) => {
    const ctx = createToolContext({ runId: "wiki_mig", autoApprove: true });
    await fs.mkdir(nodePath.join(root, "knowledge-vault"), { recursive: true });
    await fs.writeFile(nodePath.join(root, "knowledge-vault", "legacy-marker.txt"), "migrated-content\n", "utf8");

    const res = (await wikiSetupTool({}, ctx)) as {
      root_path?: string;
      migrated_from?: string;
      migration_note?: string;
    };

    assert.equal(res.root_path, ".webagent/knowledge-vault");
    assert.equal(res.migrated_from, "knowledge-vault");
    assert.ok(res.migration_note?.includes("Moved wiki vault"));

    await assert.rejects(() => fs.access(nodePath.join(root, "knowledge-vault")));

    const marker = await fs.readFile(
      nodePath.join(root, ".webagent", "knowledge-vault", "legacy-marker.txt"),
      "utf8"
    );
    assert.match(marker, /migrated-content/);
  });
});

test("explicit root_path knowledge-vault skips migration", async () => {
  await withIsolatedWorkspaceRoot(async (root) => {
    const ctx = createToolContext({ runId: "wiki_explicit", autoApprove: true });
    await fs.mkdir(nodePath.join(root, "knowledge-vault"), { recursive: true });
    await fs.writeFile(nodePath.join(root, "knowledge-vault", "keep.txt"), "x\n", "utf8");

    const res = (await wikiSetupTool({ root_path: "knowledge-vault" }, ctx)) as {
      root_path?: string;
      migrated_from?: string;
    };

    assert.equal(res.root_path, "knowledge-vault");
    assert.equal(res.migrated_from, undefined);
    await fs.access(nodePath.join(root, "knowledge-vault", "keep.txt"));
    await assert.rejects(() => fs.access(nodePath.join(root, ".webagent", "knowledge-vault")));
  });
});

test("when legacy and canonical vault both exist, implicit wiki_search prefers canonical and notes legacy", async () => {
  await withIsolatedWorkspaceRoot(async (root) => {
    const ctx = createToolContext({ runId: "wiki_both", autoApprove: true });

    await fs.mkdir(
      nodePath.join(root, "knowledge-vault", "Resources", "KnowledgeVault"),
      { recursive: true }
    );
    await fs.writeFile(
      nodePath.join(root, "knowledge-vault", "Resources", "KnowledgeVault", "old.md"),
      "# only in legacy\nuniquelegacytoken\n",
      "utf8"
    );

    await fs.mkdir(
      nodePath.join(root, ".webagent", "knowledge-vault", "Resources", "KnowledgeVault"),
      { recursive: true }
    );
    await fs.writeFile(
      nodePath.join(root, ".webagent", "knowledge-vault", "Resources", "KnowledgeVault", "index.md"),
      "# canonical\nuniquenewtoken\n",
      "utf8"
    );

    const res = (await wikiSearchTool({ query: "uniquenewtoken" }, ctx)) as {
      migration_note?: string;
      matches?: Array<{ path?: string }>;
    };

    assert.ok(res.migration_note?.includes("Legacy wiki vault exists"));
    assert.ok(res.matches?.some((m) => String(m.path ?? "").includes("index.md")));

    const legacyHit = await wikiSearchTool({ query: "uniquelegacytoken" }, ctx);
    const legacyMatches = (legacyHit as { matches?: unknown[] }).matches || [];
    assert.equal(legacyMatches.length, 0);
  });
});
