import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import {
  evaluateBackgroundReviewTrigger,
  summarizeBackgroundReviewActions,
  noteToolIteration,
  noteForegroundSkillWrite,
  noteUserTurnStarted,
  resetSelfImproveCounters,
  DEFAULT_SKILL_REVIEW_INTERVAL,
  DEFAULT_MEMORY_REVIEW_INTERVAL,
} from "../dist/agent-runtime/background-review.js";
import { loadCuratorState } from "../dist/agent-runtime/curator.js";

test("evaluateBackgroundReviewTrigger fires skill review after iteration threshold on complex turn", () => {
  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    finalVisibleText: "Done.",
    availableToolNames: ["skill_manage", "skill_save", "read_file"],
  });
  assert.equal(result.shouldReviewSkills, true);
  assert.equal(result.kind, "skill");
});

test("evaluateBackgroundReviewTrigger skips skill review when foreground already saved a skill", () => {
  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: true,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    finalVisibleText: "Done.",
    availableToolNames: ["skill_manage", "skill_save"],
  });
  assert.equal(result.shouldReviewSkills, false);
  assert.equal(result.kind, null);
});

test("evaluateBackgroundReviewTrigger fires memory review after turn threshold", () => {
  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_MEMORY_REVIEW_INTERVAL; i += 1) noteUserTurnStarted();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: false,
    skillMutatingCalled: false,
    usedTodoWrite: false,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    finalVisibleText: "Hello.",
    availableToolNames: ["memory_save", "memory_search"],
  });
  assert.equal(result.shouldReviewMemory, true);
  assert.equal(result.kind, "memory");
});

test("evaluateBackgroundReviewTrigger skips aborted turns", () => {
  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  const result = evaluateBackgroundReviewTrigger({
    status: "aborted",
    aborted: true,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: true,
    finalVisibleText: "Stopped.",
    availableToolNames: ["skill_manage"],
  });
  assert.equal(result.kind, null);
});

test("noteForegroundSkillWrite resets skill iteration counter", () => {
  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  noteForegroundSkillWrite();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    finalVisibleText: "Done.",
    availableToolNames: ["skill_manage"],
  });
  assert.equal(result.shouldReviewSkills, false);
});

test("summarizeBackgroundReviewActions extracts skill and memory updates", () => {
  const lines = summarizeBackgroundReviewActions([
    { tool: "skill_save", status: "ok", result: { name: "deploy-checklist", slug: "deploy-checklist" } },
    { tool: "memory_save", status: "ok", result: { key: "timezone" } },
    { tool: "read_file", status: "ok", result: { ok: true } },
  ]);
  assert.deepEqual(lines, ["Skill 'deploy-checklist' created", "Memory updated"]);
});

test("applyAutomaticSkillTransitions marks stale and archived agent-created skills", async () => {
  const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-skill-usage-"));
  process.env.WEBAGENT_WORKSPACE_ROOT = tmp;
  const provenance = await import(`../dist/agent-runtime/skill-provenance.js?v=${Date.now()}`);
  const skillsDir = nodePath.join(tmp, ".webagent", "skills");
  await fs.mkdir(skillsDir, { recursive: true });

  await provenance.markAgentCreated("old-skill");
  const usage = await provenance.listSkillUsage();
  usage["old-skill"] = {
    ...usage["old-skill"],
    created_by: "agent",
    created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    last_viewed_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    state: "active",
  };
  await fs.writeFile(
    nodePath.join(skillsDir, ".usage.json"),
    JSON.stringify(usage, null, 2),
    "utf8"
  );

  const out = await provenance.applyAutomaticSkillTransitions({
    staleAfterDays: 30,
    archiveAfterDays: 90,
  });
  assert.ok(out.archived.includes("old-skill"));
  const after = await provenance.listSkillUsage();
  assert.equal(after["old-skill"]?.state, "archived");

  delete process.env.WEBAGENT_WORKSPACE_ROOT;
});

test("applyAutomaticSkillTransitions skips pinned skills", async () => {
  const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-skill-pinned-"));
  process.env.WEBAGENT_WORKSPACE_ROOT = tmp;
  const provenance = await import(`../dist/agent-runtime/skill-provenance.js?v=${Date.now()}`);
  const skillsDir = nodePath.join(tmp, ".webagent", "skills");
  await fs.mkdir(skillsDir, { recursive: true });

  await provenance.markAgentCreated("pinned-skill");
  await provenance.setSkillPinned("pinned-skill", true);
  const usage = await provenance.listSkillUsage();
  usage["pinned-skill"] = {
    ...usage["pinned-skill"],
    created_by: "agent",
    created_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    last_viewed_at: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    state: "active",
    pinned: true,
  };
  await fs.writeFile(
    nodePath.join(skillsDir, ".usage.json"),
    JSON.stringify(usage, null, 2),
    "utf8"
  );

  const out = await provenance.applyAutomaticSkillTransitions({
    staleAfterDays: 30,
    archiveAfterDays: 90,
  });
  assert.equal(out.archived.includes("pinned-skill"), false);
  const after = await provenance.listSkillUsage();
  assert.notEqual(after["pinned-skill"]?.state, "archived");

  delete process.env.WEBAGENT_WORKSPACE_ROOT;
});

test("loadCuratorState returns defaults when file missing", async () => {
  const state = await loadCuratorState();
  assert.equal(state.paused, false);
  assert.equal(state.run_count, 0);
});
