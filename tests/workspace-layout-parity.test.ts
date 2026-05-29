/**
 * Ensures workspace-relative strings stay aligned between the typechecked app
 * (`src/core/workspace-layout.ts`) and the embed-compiled agent runtime.
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as coreLayout from "../src/core/workspace-layout";

test("embed runtime path constants match workspace-layout", async () => {
  const { PLANS_DIR_REL, SESSION_MEMORY_PATH, TELEGRAM_AUTH_REL, WS } =
    await import("../dist/agent-runtime/constants.js");
  const { WIKI_DEFAULT_ROOT } = await import("../dist/agent-runtime/tools/wiki-tools.js");
  const runtimeLayout = await import("../dist/agent-runtime/workspace-layout.js");

  assert.equal(PLANS_DIR_REL, coreLayout.WORKSPACE_PLANS_DIR_REL);
  assert.equal(TELEGRAM_AUTH_REL, coreLayout.WORKSPACE_TELEGRAM_AUTH_REL);
  assert.equal(SESSION_MEMORY_PATH, `${WS}/${coreLayout.WORKSPACE_SESSION_MEMORY_REL}`);
  assert.equal(WIKI_DEFAULT_ROOT, coreLayout.WORKSPACE_KNOWLEDGE_VAULT_DIR_REL);

  assert.deepEqual(
    [...runtimeLayout.WORKSPACE_WEBAGENT_USER_SUBDIRS],
    [...coreLayout.WORKSPACE_WEBAGENT_USER_SUBDIRS]
  );
  assert.deepEqual(
    [...runtimeLayout.WORKSPACE_MEMORY_SUBDIRS],
    [...coreLayout.WORKSPACE_MEMORY_SUBDIRS]
  );
  assert.deepEqual(runtimeLayout.workspaceBootstrapDirRels(), coreLayout.workspaceBootstrapDirRels());
  assert.equal(runtimeLayout.WORKSPACE_TELEGRAM_INBOX_REL, coreLayout.WORKSPACE_TELEGRAM_INBOX_REL);
  assert.equal(runtimeLayout.WORKSPACE_BUNDLED_SKILLS_REL, coreLayout.WORKSPACE_BUNDLED_SKILLS_REL);
});
