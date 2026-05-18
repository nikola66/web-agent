/**
 * Ensures workspace-relative strings stay aligned between the typechecked app
 * (`src/core/workspace-layout.ts`) and the embed-compiled agent runtime.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_KNOWLEDGE_VAULT_DIR_REL,
  WORKSPACE_PLANS_DIR_REL,
  WORKSPACE_SESSION_MEMORY_REL,
  WORKSPACE_TELEGRAM_AUTH_REL,
} from "../src/core/workspace-layout";

test("embed runtime path constants match workspace-layout", async () => {
  const { PLANS_DIR_REL, SESSION_MEMORY_PATH, TELEGRAM_AUTH_REL, WS } =
    await import("../dist/agent-runtime/constants.js");
  const { WIKI_DEFAULT_ROOT } = await import("../dist/agent-runtime/tools/wiki-tools.js");

  assert.equal(PLANS_DIR_REL, WORKSPACE_PLANS_DIR_REL);
  assert.equal(TELEGRAM_AUTH_REL, WORKSPACE_TELEGRAM_AUTH_REL);
  assert.equal(SESSION_MEMORY_PATH, `${WS}/${WORKSPACE_SESSION_MEMORY_REL}`);
  assert.equal(WIKI_DEFAULT_ROOT, WORKSPACE_KNOWLEDGE_VAULT_DIR_REL);
});
