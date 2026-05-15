import test from "node:test";
import assert from "node:assert/strict";

import {
  assistantSignalsTaskCompleteForSkillCapture,
  estimateTaskComplexity,
  isPlanningModePrompt,
} from "../dist/agent-runtime/turn-sequencing.js";
import { getSkillSelfImproveNudgeState } from "../dist/agent-runtime/auto-continue.js";

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

test("assistantSignalsTaskCompleteForSkillCapture accepts Done", () => {
  assert.equal(assistantSignalsTaskCompleteForSkillCapture("Done."), true);
});

test("assistantSignalsTaskCompleteForSkillCapture rejects trailing Next:", () => {
  assert.equal(assistantSignalsTaskCompleteForSkillCapture("Next:"), false);
});

test("getSkillSelfImproveNudgeState fires when todo used and assistant signals complete", () => {
  const s = getSkillSelfImproveNudgeState({
    visible: "All tasks complete.",
    executedToolsInTurn: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    autoContinueNudges: 0,
    maxNudges: 20,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState skips when skill mutating tool already ran", () => {
  const s = getSkillSelfImproveNudgeState({
    visible: "Done.",
    executedToolsInTurn: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: true,
    autoContinueNudges: 0,
    maxNudges: 20,
  });
  assert.equal(s.shouldNudge, false);
});

test("getSkillSelfImproveNudgeState fires when planning gate used and assistant signals complete", () => {
  const s = getSkillSelfImproveNudgeState({
    visible: "Migration finished.",
    executedToolsInTurn: true,
    usedTodoWrite: false,
    usedPlanningGate: true,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    autoContinueNudges: 0,
    maxNudges: 20,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState fires when estimated steps over six and assistant signals complete", () => {
  const s = getSkillSelfImproveNudgeState({
    visible: "All set.",
    executedToolsInTurn: true,
    usedTodoWrite: false,
    usedPlanningGate: false,
    estimatedStepsOverSix: true,
    skillMutatingCalled: false,
    autoContinueNudges: 0,
    maxNudges: 20,
  });
  assert.equal(s.shouldNudge, true);
});

test("getSkillSelfImproveNudgeState skips when no tools executed this turn", () => {
  const s = getSkillSelfImproveNudgeState({
    visible: "Done.",
    executedToolsInTurn: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    skillMutatingCalled: false,
    autoContinueNudges: 0,
    maxNudges: 20,
  });
  assert.equal(s.shouldNudge, false);
});
