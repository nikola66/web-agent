import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWikiSearchUserPrompt,
  buildWikiSetupUserPrompt,
  buildWikiSyncUserPrompt,
  rewriteWikiSlashUserMessage,
} from "../dist/agent-runtime/wiki-slash.js";

test("buildWikiSetupUserPrompt mentions invoked slash and wiki_setup tool", () => {
  const p = buildWikiSetupUserPrompt("");
  assert.match(p, /\/wiki_setup/);
  assert.match(p, /wiki_setup/);
  assert.match(p, /\.webagent\/knowledge-vault/);
});

test("buildWikiSyncUserPrompt parses scope and optional root", () => {
  const p = buildWikiSyncUserPrompt("facts");
  assert.match(p, /wiki_sync/);
  assert.match(p, /"scope":"facts"/);
  const p2 = buildWikiSyncUserPrompt("session my-vault");
  assert.match(p2, /"scope":"session"/);
  assert.match(p2, /my-vault/);
});

test("buildWikiSearchUserPrompt requires query when empty", () => {
  const p = buildWikiSearchUserPrompt("");
  assert.match(p, /without a query/i);
});

test("buildWikiSearchUserPrompt passes query", () => {
  const p = buildWikiSearchUserPrompt("PARA method");
  assert.match(p, /wiki_search/);
  assert.match(p, /PARA method/);
});

test("rewriteWikiSlashUserMessage maps slash to synthetic prompt", () => {
  const p = rewriteWikiSlashUserMessage("/wiki_setup");
  assert.ok(p);
  assert.match(p, /wiki_setup/);
});
