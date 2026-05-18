import test from "node:test";
import assert from "node:assert/strict";

import { buildPlanModeUserPrompt } from "../dist/agent-runtime/planning-slash.js";

test("buildPlanModeUserPrompt includes plan path, tools, and follow-up", () => {
  const fixed = new Date(2026, 4, 14, 9, 8, 7);
  const p = buildPlanModeUserPrompt("Add auth flow", fixed);
  assert.ok(p.includes("plans/"));
  assert.match(p, /2026-05-14_090807-add-auth-flow\.md/);
  assert.match(p, /Do \*\*not\*\* call make_dir for this plan path/);
  assert.match(p, /artifact_present/);
  assert.match(p, /Execute the plan/i);
});

test("buildPlanModeUserPrompt empty goal uses plan slug", () => {
  const p = buildPlanModeUserPrompt("", new Date(2026, 0, 1, 0, 0, 0));
  assert.match(p, /Infer the planning goal/);
  assert.match(p, /2026-01-01_000000-plan\.md/);
});
