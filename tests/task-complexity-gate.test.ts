import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateTaskComplexity,
  isPlanningModePrompt,
  extractPlanningGoalFromPrompt,
  isExplicitPlanExecutionRequest,
  buildPlanExecutionContextPrefix,
  isExecutionContinuationIntent,
  isSkillInstallIntent,
  focusToolNamesForIntent,
  buildSkillInstallContextPrefix,
  buildApiCallContextPrefix,
  buildComposioSaasContextPrefix,
  isComposioSaasIntent,
  skillBulkSaveAllUrlItemsFailed,
  webFetchTargetsRegistryUrl,
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

test("estimateTaskComplexity stays simple for continuation directives", () => {
  assert.equal(isExecutionContinuationIntent("Continue until completion"), true);
  assert.equal(isExecutionContinuationIntent("Continue"), true);
  assert.equal(isExecutionContinuationIntent("keep going"), true);
  assert.equal(isExecutionContinuationIntent("Shall we continue installing them?"), true);
  assert.equal(isExecutionContinuationIntent("Let's continue with the skill install"), true);
  assert.equal(isExecutionContinuationIntent("continue installing the remaining skills"), true);
  assert.equal(isExecutionContinuationIntent("Don't pause anymore"), true);
  assert.equal(isExecutionContinuationIntent("no more pauses"), true);
  const r = estimateTaskComplexity("Continue until completion");
  assert.equal(r.tier, "simple");
  assert.equal(r.estimatedSteps, 1);
});

test("isExplicitPlanExecutionRequest detects plan approved and bare start", () => {
  assert.equal(isExplicitPlanExecutionRequest("Plan approved"), true);
  assert.equal(isExplicitPlanExecutionRequest("Start"), true);
  assert.equal(isExplicitPlanExecutionRequest("Go ahead"), true);
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

test("isSkillInstallIntent detects install and registry mentions", () => {
  assert.equal(isSkillInstallIntent("Install skills from this awesome list"), true);
  assert.equal(isSkillInstallIntent("Continue installing them"), true);
  assert.equal(isSkillInstallIntent("https://officialskills.sh/foo/bar"), true);
  assert.equal(isSkillInstallIntent("What is the weather"), false);
});

test("buildSkillInstallContextPrefix warns about curated indexes", () => {
  const prefix = buildSkillInstallContextPrefix("bulk save skills from officialskills.sh");
  assert.ok(prefix);
  assert.match(prefix!, /indexes/i);
  assert.match(prefix!, /do not guess raw paths/i);
  assert.match(prefix!, /imported-skill-compat/);
  assert.doesNotMatch(prefix!, /VoltAgent/i);
});

test("buildSkillInstallContextPrefix nudges python runtime for python skills", () => {
  const prefix = buildSkillInstallContextPrefix("install python skill with pip install helpers");
  assert.ok(prefix);
  assert.match(prefix!, /run_python/);
  assert.match(prefix!, /http-api/);
});

test("focusToolNamesForIntent narrows skill install tools", () => {
  assert.deepEqual(
    focusToolNamesForIntent(
      ["read_file", "extract_archive", "skill_manage", "run_shell", "composio_action"],
      "Install this skill from uploads/archive.zip"
    ),
    ["read_file", "extract_archive", "skill_manage"]
  );
});

test("buildApiCallContextPrefix nudges http-api and skill discovery for graphql tasks", () => {
  const prefix = buildApiCallContextPrefix("how many job posts via graphql");
  assert.ok(prefix);
  assert.match(prefix!, /http-api/);
  assert.match(prefix!, /web_fetch/);
  assert.match(prefix!, /discovery/i);
  assert.doesNotMatch(prefix!, /directus/i);
});

test("buildApiCallContextPrefix orders discovery before guessing resources", () => {
  const prefix = buildApiCallContextPrefix("connect to our cms api with bearer token");
  assert.ok(prefix);
  assert.match(prefix!, /discovery/i);
  assert.match(prefix!, /Do not retry/i);
  assert.doesNotMatch(prefix!, /\/collections/);
});

test("isComposioSaasIntent matches linkedin account queries", () => {
  assert.equal(isComposioSaasIntent("What's happening on my LinkedIn today?"), true);
  assert.equal(isComposioSaasIntent("list files in workspace"), false);
});

test("buildComposioSaasContextPrefix nudges composio_status before claiming no access", () => {
  const prefix = buildComposioSaasContextPrefix("What's happening on my LinkedIn today?");
  assert.ok(prefix);
  assert.match(prefix!, /composio-oauth/);
  assert.match(prefix!, /composio_status/);
  assert.match(prefix!, /no access/i);
  assert.match(prefix!, /Offer `composio_connect` only when status shows the app is missing/i);
  assert.match(prefix!, /do not web_search or web_fetch GitHub/i);
});

test("skillBulkSaveAllUrlItemsFailed detects total URL failure batch", () => {
  const exec = [
    {
      tool: "skill_bulk_save",
      result: { summary: { saved: 0, failed: 11, blocked: 0 } },
    },
  ];
  assert.equal(skillBulkSaveAllUrlItemsFailed(exec), true);
  assert.equal(
    skillBulkSaveAllUrlItemsFailed([
      { tool: "skill_bulk_save", result: { summary: { saved: 2, failed: 1, blocked: 0 } } },
    ]),
    false
  );
});

test("webFetchTargetsRegistryUrl detects officialskills fetch", () => {
  const tools = [
    {
      name: "web_fetch",
      arguments: { url: "https://officialskills.sh/anthropics/skills/frontend-design" },
    },
  ];
  const exec = [{ tool: "web_fetch", result: { ok: true } }];
  assert.equal(webFetchTargetsRegistryUrl(tools, exec), true);
});
