import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFindSkillsModeUserPrompt,
  rewriteFindSkillsSlashUserMessage,
  rewriteFindSkillsIntentUserMessage,
  resolveFindSkillsUserMessage,
} from "../dist/agent-runtime/find-skills-slash.js";

test("buildFindSkillsModeUserPrompt includes query, skill view, and top-5 contract", () => {
  const p = buildFindSkillsModeUserPrompt("pdf extraction");
  assert.match(p, /find-skills mode/i);
  assert.match(p, /\/find_skills/);
  assert.match(p, /pdf extraction/);
  assert.match(p, /skill.*find-skills/i);
  assert.match(p, /exactly \*\*5\*\*/);
  assert.match(p, /skills\.sh/);
  assert.match(p, /only these 3/);
  assert.match(p, /3 `web_search`/);
  assert.match(p, /2 `web_fetch`/);
});

test("rewriteFindSkillsSlashUserMessage accepts /find_skills only", () => {
  assert.ok(rewriteFindSkillsSlashUserMessage("/find_skills pdf"));
  assert.equal(rewriteFindSkillsSlashUserMessage("/find-skills pdf"), null);
});

test("buildFindSkillsModeUserPrompt empty query infers from conversation", () => {
  const p = buildFindSkillsModeUserPrompt("");
  assert.match(p, /Infer the skill-discovery query/);
});

test("rewriteFindSkillsIntentUserMessage matches natural-language skill discovery", () => {
  const p = rewriteFindSkillsIntentUserMessage(
    "Can you find me the best Agent skill for high quality SEO auditing?"
  );
  assert.ok(p);
  assert.match(p!, /find-skills mode/i);
  assert.match(p!, /SEO auditing/i);
  assert.match(p!, /skill.*find-skills/i);
});

test("rewriteFindSkillsIntentUserMessage rejects unrelated asks", () => {
  assert.equal(rewriteFindSkillsIntentUserMessage("Fix the typo in README"), null);
  assert.equal(rewriteFindSkillsIntentUserMessage("He skillfully avoided the issue"), null);
});

test("resolveFindSkillsUserMessage prefers slash then intent", () => {
  assert.ok(resolveFindSkillsUserMessage("/find_skills seo audit"));
  assert.ok(
    resolveFindSkillsUserMessage("find the best agent skill for pdf extraction")
  );
});
