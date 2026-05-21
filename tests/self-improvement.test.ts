import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import nodePath from "node:path";
import os from "node:os";

import {
  evaluateBackgroundReviewTrigger,
  summarizeBackgroundReviewActions,
  summarizeBackgroundReviewActionsDetailed,
  noteToolIteration,
  noteForegroundSkillWrite,
  noteUserTurnStarted,
  resetSelfImproveCounters,
  getSelfImproveCounters,
  DEFAULT_SKILL_REVIEW_INTERVAL,
  DEFAULT_MEMORY_REVIEW_INTERVAL,
} from "../dist/agent-runtime/background-review.js";
import { loadCuratorState, maybeRunCurator } from "../dist/agent-runtime/curator.js";
import { runHeartbeatTick } from "../dist/agent-runtime/state/persistence.js";

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
    availableToolNames: ["skill_manage", "read_file"],
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
    availableToolNames: ["skill_manage"],
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
    { tool: "skill_manage", status: "ok", result: { action: "create", name: "deploy-checklist", slug: "deploy-checklist" } },
    { tool: "memory_save", status: "ok", result: { key: "timezone" } },
    { tool: "read_file", status: "ok", result: { ok: true } },
  ]);
  assert.deepEqual(lines, ["Skill 'deploy-checklist' created", "Memory updated"]);
});

test("summarizeBackgroundReviewActionsDetailed counts created vs patched", () => {
  const summary = summarizeBackgroundReviewActionsDetailed([
    { tool: "skill_manage", status: "ok", result: { action: "create", name: "a", slug: "a" } },
    { tool: "skill_manage", status: "ok", result: { action: "create", name: "b", slug: "b" } },
    { tool: "skill_manage", status: "ok", result: { action: "patch", name: "c", slug: "c" } },
    { tool: "memory_save", status: "ok", result: { key: "k" } },
  ]);
  assert.equal(summary.skillsCreated, 2);
  assert.equal(summary.skillsPatched, 1);
  assert.equal(summary.memoryUpdates, 1);
  assert.ok(summary.lines.length >= 3);
});

test("evaluateBackgroundReviewTrigger accelerates skill review on tool-heavy turns", () => {
  resetSelfImproveCounters();
  const accelerated = Math.max(3, DEFAULT_SKILL_REVIEW_INTERVAL - 4);
  for (let i = 0; i < accelerated; i += 1) noteToolIteration();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: false,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    toolRoundCount: 4,
    toolCallCount: 6,
    finalVisibleText: "Done.",
    availableToolNames: ["skill_manage", "read_file"],
  });
  assert.equal(result.shouldReviewSkills, true);
  assert.equal(result.kind, "skill");
});

test("evaluateBackgroundReviewTrigger fires skill review at 8+ tool calls without full interval", () => {
  resetSelfImproveCounters();
  noteToolIteration();
  const result = evaluateBackgroundReviewTrigger({
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: true,
    usedPlanningGate: false,
    estimatedStepsOverSix: false,
    toolRoundCount: 3,
    toolCallCount: 8,
    finalVisibleText: "Done.",
    availableToolNames: ["skill_manage"],
  });
  assert.equal(result.shouldReviewSkills, true);
});

test("hermes parity benchmark: complex-turn fixture triggers skill review more often", () => {
  const complexTurnFixture = {
    status: "completed",
    aborted: false,
    executedToolsInTurn: true,
    skillMutatingCalled: false,
    usedTodoWrite: true,
    usedPlanningGate: true,
    estimatedStepsOverSix: true,
    toolRoundCount: 5,
    toolCallCount: 12,
    finalVisibleText: "Implemented and verified.",
    availableToolNames: ["skill_manage", "memory_save", "read_file"],
  };

  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  const webAgent = evaluateBackgroundReviewTrigger(complexTurnFixture);
  assert.equal(webAgent.shouldReviewSkills, true, "web-agent should review skills on Hermes-like complex turn");

  resetSelfImproveCounters();
  for (let i = 0; i < DEFAULT_SKILL_REVIEW_INTERVAL; i += 1) noteToolIteration();
  const hermesBaseline = evaluateBackgroundReviewTrigger({
    ...complexTurnFixture,
    toolRoundCount: undefined,
    toolCallCount: undefined,
  });
  assert.equal(hermesBaseline.shouldReviewSkills, true, "baseline interval gate still passes");

  const counters = getSelfImproveCounters();
  assert.equal(counters.itersSinceSkill, 0, "counter resets after skill review trigger");
});

test("maybeRunCurator records check without incrementing run_count on skip", async () => {
  const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-curator-check-"));
  process.env.WEBAGENT_WORKSPACE_ROOT = tmp;
  const result = await maybeRunCurator({ cfg: {}, force: false });
  assert.equal(result.ran, false);
  assert.ok(result.skipReason);
  const state = await loadCuratorState();
  assert.equal(state.run_count, 0);
  assert.ok(state.last_checked_at);
  assert.equal(state.last_run_at, null);
  delete process.env.WEBAGENT_WORKSPACE_ROOT;
});

test("runHeartbeatTick polls curator when no cron jobs exist", async () => {
  const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-heartbeat-curator-"));
  process.env.WEBAGENT_WORKSPACE_ROOT = tmp;
  const skillsDir = nodePath.join(tmp, ".webagent", "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  const heartbeatPath = nodePath.join(tmp, ".webagent", "heartbeat-state.json");
  await fs.writeFile(
    heartbeatPath,
    JSON.stringify({ lastHeartbeatAt: 0 }, null, 2),
    "utf8"
  );
  await fs.writeFile(nodePath.join(tmp, ".webagent", "cronjobs.json"), JSON.stringify({ jobs: [] }), "utf8");

  const runTool = async () => ({ ok: true });
  await runHeartbeatTick(runTool, "test", { cfg: {}, idleForMs: Number.POSITIVE_INFINITY });

  const state = await loadCuratorState();
  assert.ok(state.last_checked_at, "curator should be checked on heartbeat without cron jobs");

  delete process.env.WEBAGENT_WORKSPACE_ROOT;
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

test("semantic index ranks related facts above unrelated ones", async () => {
  const tmp = await fs.mkdtemp(nodePath.join(os.tmpdir(), "webagent-semantic-"));
  process.env.WEBAGENT_WORKSPACE_ROOT = tmp;
  process.env.WEBAGENT_MEMORY_ROOT = nodePath.join(tmp, "memory");

  const semantic = await import(`../dist/agent-runtime/memory/semantic-index.js?v=${Date.now()}`);
  await semantic.upsertFactEmbedding("user_timezone", "America/Chicago");
  await semantic.upsertFactEmbedding("favorite_color", "blue");

  const hits = await semantic.searchFactEmbeddings("timezone america chicago", 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].key, "user_timezone");

  delete process.env.WEBAGENT_WORKSPACE_ROOT;
  delete process.env.WEBAGENT_MEMORY_ROOT;
});

test("self-improvement IPC markers are stable", async () => {
  const constants = await import("../dist/agent-runtime/constants.js");
  assert.match(String(constants.SELF_IMPROVEMENT_START), /^<<<WEBAGENT_/);
  assert.match(String(constants.SELF_IMPROVEMENT_END), /^<<<END_WEBAGENT_/);
});
