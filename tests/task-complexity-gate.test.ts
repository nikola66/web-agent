import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateTaskComplexity,
  isPlanningModePrompt,
  extractPlanningGoalFromPrompt,
  isExplicitPlanExecutionRequest,
  buildPlanExecutionContextPrefix,
} from "../dist/agent-runtime/turn-sequencing.js";
import { getSkillSelfImproveNudgeState } from "../dist/agent-runtime/turn-sequencing.js";
import { buildPlanModeUserPrompt } from "../dist/agent-runtime/planning-slash.js";

test("estimateTaskComplexity is simple for short asks", () => {
  const r = estimateTaskComplexity("Fix the typo in README");
  assert.equal(r.tier, "simple");
  assert.ok(r.estimatedSteps <= 3);
});

test("estimateTaskComplexity todo tier from numbered steps", () => {
  const r = estimateTaskComplexity("Complete these 5 steps for the migration");
  assert.equal(r.tier, "todo");
  assert.equal(r.estimatedSteps, 5);
});

test("estimateTaskComplexity plan tier from high step count", () => {
  const r = estimateTaskComplexity("Follow these 9 tasks in order");
  assert.equal(r.tier, "plan");
  assert.equal(r.estimatedSteps, 9);
});

test("estimateTaskComplexity plan tier when user specifies multiple rounds", () => {
  const r = estimateTaskComplexity(
    "For 5 rounds, research a topic, write a summary in markdown, translate to Arabic and German, then save as files."
  );
  assert.equal(r.tier, "plan");
  assert.ok(r.estimatedSteps >= 8);
});

test("estimateTaskComplexity plan tier from Hermes-style semicolon-delivered checklist", () => {
  const r = estimateTaskComplexity(
    "Update dependency pins; refresh the lockfile; run the full test suite; draft release notes."
  );
  assert.equal(r.tier, "plan");
});

test("estimateTaskComplexity plan tier from long imperative verb chain without explicit steps/tasks", () => {
  const r = estimateTaskComplexity(
    "Refactor auth, update API docs, migrate the database, notify customers, and remove the legacy flag."
  );
  assert.equal(r.tier, "plan");
});

test("estimateTaskComplexity plan tier when repeat-until specifies deliverables", () => {
  const r = estimateTaskComplexity(
    "Repeat until you have 5 markdown articles saved in the output folder."
  );
  assert.equal(r.tier, "plan");
});

test("estimateTaskComplexity stays simple for tiny two-action asks", () => {
  const r = estimateTaskComplexity("Fix the typo in README and save.");
  assert.equal(r.tier, "simple");
});

test("isPlanningModePrompt matches synthetic /plan prompt line", () => {
  assert.equal(
    isPlanningModePrompt("The user invoked **planning mode** via `/plan`. Follow it strictly."),
    true
  );
  assert.equal(isPlanningModePrompt("regular user ask"), false);
});

test("extractPlanningGoalFromPrompt parses **Goal:** from synthetic prompt", () => {
  const p = buildPlanModeUserPrompt("Ship auth", new Date(2026, 0, 15, 12, 0, 0));
  assert.equal(extractPlanningGoalFromPrompt(p), "Ship auth");
});

test("isExplicitPlanExecutionRequest ignores follow-up after planning prompt", () => {
  const plan = buildPlanModeUserPrompt("Migrate DB");
  assert.equal(isExplicitPlanExecutionRequest("Proceed"), false);
  assert.equal(isExplicitPlanExecutionRequest(plan), false);
  assert.equal(isExplicitPlanExecutionRequest("List them here in a nice way"), false);
});

test("isExplicitPlanExecutionRequest detects explicit plan-approval phrasing", () => {
  assert.equal(isExplicitPlanExecutionRequest("PLan is approved, execute it"), true);
});

test("isExplicitPlanExecutionRequest detects plan file paths in current message", () => {
  assert.equal(
    isExplicitPlanExecutionRequest(
      "Run it: plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md"
    ),
    true
  );
  assert.equal(
    isExplicitPlanExecutionRequest(
      "It's here: .webagent/plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md"
    ),
    true
  );
});

test("buildPlanExecutionContextPrefix returns prefix only for explicit execution", () => {
  assert.equal(buildPlanExecutionContextPrefix("hello"), null);
  assert.match(
    buildPlanExecutionContextPrefix("execute the plan") ?? "",
    /\[Approved plan execution context\]/
  );
});

test("getSkillSelfImproveNudgeState fires when todo used after tools executed", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    skillImproveNudgeSent: false,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState skips when skill mutating tool already ran", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: true,
    skillImproveNudgeSent: false,
  });
  assert.equal(s.shouldNudge, false);
});

test("getSkillSelfImproveNudgeState skips when nudge already sent", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    skillImproveNudgeSent: true,
  });
  assert.equal(s.shouldNudge, false);
});

test("getSkillSelfImproveNudgeState fires when planning gate used", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: true,
    usedTodoWrite: false,
    usedPlanningGate: true,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    skillImproveNudgeSent: false,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState fires when estimated steps over six", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: true,
    usedTodoWrite: false,
    usedPlanningGate: false,
    estimatedStepsOverSix: true,
    skillMutatingCalled: false,
    skillImproveNudgeSent: false,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState skips when no tools executed this turn", () => {
  const s = getSkillSelfImproveNudgeState({
    executedToolsInTurn: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    skillImproveNudgeSent: false,
  });
  assert.equal(s.shouldNudge, false);
});
