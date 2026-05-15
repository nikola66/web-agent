import test from "node:test";
import assert from "node:assert/strict";

import {
  isResearchIntent,
  shouldNudgeIncompleteResearchReply,
  shouldTreatPostToolTextAsFinal,
  MIN_RESEARCH_SEARCHES,
  MIN_RESEARCH_FETCHES,
} from "../dist/agent-runtime/turn-sequencing.js";
import { resolveMaxAutoContinueNudges } from "../dist/agent-runtime/auto-continue.js";

const BENCHMARK_PROMPT =
  "Please help me find YouTubers in UAE and KSA posting about openclaw and hermes agent";

test("isResearchIntent matches benchmark discover prompt", () => {
  assert.equal(isResearchIntent(BENCHMARK_PROMPT), true);
});

test("isResearchIntent is false for unrelated tasks", () => {
  assert.equal(isResearchIntent("Fix the typo in README.md"), false);
});

test("shouldNudgeIncompleteResearchReply after premature none-found", () => {
  const visible =
    "I've combed through the data, and no YouTubers in UAE or KSA are posting about OpenClaw yet. Would you like me to draft a reach-out script?";
  assert.equal(
    shouldNudgeIncompleteResearchReply(visible, {
      researchIntent: true,
      webSearchCount: 2,
      webFetchCount: 0,
    }),
    true
  );
});

test("shouldTreatPostToolTextAsFinal is false for incomplete research", () => {
  const visible =
    "The direct search didn't yield any specific YouTubers. I recommend targeting AI power-users instead.";
  assert.equal(
    shouldTreatPostToolTextAsFinal(visible, {
      researchIntent: true,
      webSearchCount: 2,
      webFetchCount: 0,
    }),
    false
  );
});

test("shouldTreatPostToolTextAsFinal allows stop when research minimums met", () => {
  const visible =
    "Here is the final list of creators with links and a summary table.";
  assert.equal(
    shouldTreatPostToolTextAsFinal(visible, {
      researchIntent: true,
      webSearchCount: MIN_RESEARCH_SEARCHES,
      webFetchCount: MIN_RESEARCH_FETCHES,
    }),
    true
  );
});

test("resolveMaxAutoContinueNudges raises cap for research prompts", () => {
  assert.ok(resolveMaxAutoContinueNudges(BENCHMARK_PROMPT) >= 30);
  assert.equal(resolveMaxAutoContinueNudges("List files in src"), 20);
});

test("Novara v2: nudge when many searches but zero fetches and zero verdict", () => {
  const visible = `I've exhausted the search parameters, including specific tool/location combinations and regional tech influencer lists. Here is the final, verified breakdown.

The Final Verdict
There are zero YouTubers in the UAE or KSA who are currently posting dedicated content about "OpenClaw" or "Hermes Agent."`;
  assert.equal(
    shouldNudgeIncompleteResearchReply(visible, {
      researchIntent: true,
      webSearchCount: 11,
      webFetchCount: 0,
    }),
    true
  );
  assert.equal(
    shouldTreatPostToolTextAsFinal(visible, {
      researchIntent: true,
      webSearchCount: 11,
      webFetchCount: 0,
    }),
    false
  );
});

test("Novara v2: mid-task Want me to nudge when fetches incomplete", () => {
  const visible =
    "Want me to try searching for the top tech/AI YouTubers in the UAE and KSA first?";
  assert.equal(
    shouldNudgeIncompleteResearchReply(visible, {
      researchIntent: true,
      webSearchCount: 2,
      webFetchCount: 0,
    }),
    true
  );
});
