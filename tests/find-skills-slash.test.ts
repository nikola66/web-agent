import test from "node:test";
import assert from "node:assert/strict";

import { buildFindSkillsModeUserPrompt, rewriteFindSkillsSlashUserMessage } from "../dist/agent-runtime/find-skills-slash.js";

test("buildFindSkillsModeUserPrompt includes query, skill_view, and top-5 contract", () => {
  const p = buildFindSkillsModeUserPrompt("pdf extraction");
  assert.match(p, /find-skills mode/i);
  assert.match(p, /\/find_skills/);
  assert.match(p, /pdf extraction/);
  assert.match(p, /skill_view.*find-skills/);
  assert.match(p, /exactly \*\*5\*\*/);
  assert.match(p, /skills\.sh/);
  assert.match(p, /web_search/);
  assert.match(p, /web_fetch/);
});

test("rewriteFindSkillsSlashUserMessage accepts /find_skills only", () => {
  assert.ok(rewriteFindSkillsSlashUserMessage("/find_skills pdf"));
  assert.equal(rewriteFindSkillsSlashUserMessage("/find-skills pdf"), null);
});

test("buildFindSkillsModeUserPrompt empty query infers from conversation", () => {
  const p = buildFindSkillsModeUserPrompt("");
  assert.match(p, /Infer the skill-discovery query/);
});
