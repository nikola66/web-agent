import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateTaskComplexity,
  isPlanningModePrompt,
  extractPlanningGoalFromPrompt,
  resolveApprovedPlanExecutionGoal,
} from "../dist/agent-runtime/turn-sequencing.js";
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

test("resolveApprovedPlanExecutionGoal activates after planning prompt turn", () => {
  const plan = buildPlanModeUserPrompt("Migrate DB");
  assert.equal(resolveApprovedPlanExecutionGoal({
    textOnly: true,
    priorUserContent: plan,
    currentUserContent: "Proceed",
  }), null);
  assert.equal(resolveApprovedPlanExecutionGoal({
    textOnly: false,
    priorUserContent: plan,
    currentUserContent: "Proceed",
  }), "Migrate DB");
  assert.equal(resolveApprovedPlanExecutionGoal({
    textOnly: false,
    priorUserContent: plan,
    currentUserContent: plan,
  }), null);
  assert.equal(resolveApprovedPlanExecutionGoal({
    textOnly: false,
    priorUserContent: "something else",
    currentUserContent: "Proceed",
  }), null);
});

test("resolveApprovedPlanExecutionGoal activates from explicit plan-approval phrasing", () => {
  assert.equal(
    resolveApprovedPlanExecutionGoal({
      textOnly: false,
      priorUserContent: "",
      currentUserContent: "PLan is approved, execute it",
    }),
    "Execute the most recent approved plan in plans/."
  );
});

test("resolveApprovedPlanExecutionGoal uses explicit legacy plan file path when present", () => {
  assert.equal(
    resolveApprovedPlanExecutionGoal({
      textOnly: false,
      priorUserContent: "Plan is approved, execute it",
      currentUserContent:
        "It's here: .webagent/plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md",
    }),
    "Execute approved plan at .webagent/plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md."
  );
});

test("resolveApprovedPlanExecutionGoal uses explicit plans/ path when present", () => {
  assert.equal(
    resolveApprovedPlanExecutionGoal({
      textOnly: false,
      priorUserContent: "",
      currentUserContent:
        "Run it: plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md",
    }),
    "Execute approved plan at plans/2026-05-18_204842-create-a-comprehensive-plan-for-youtube-creators.md."
  );
});

