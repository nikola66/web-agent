import test from "node:test";
import assert from "node:assert/strict";

import { isResearchIntent } from "../dist/agent-runtime/turn-sequencing.js";
import { resolveMaxAutoContinueNudges } from "../dist/agent-runtime/loop-guard.js";

const BENCHMARK_PROMPT =
  "Please help me find YouTubers in UAE and KSA posting about openclaw and hermes agent";

test("isResearchIntent matches benchmark discover prompt", () => {
  assert.equal(isResearchIntent(BENCHMARK_PROMPT), true);
});

test("isResearchIntent is false for unrelated tasks", () => {
  assert.equal(isResearchIntent("Fix the typo in README.md"), false);
});

test("resolveMaxAutoContinueNudges raises cap for research prompts", () => {
  assert.ok(resolveMaxAutoContinueNudges(BENCHMARK_PROMPT) >= 30);
  assert.equal(resolveMaxAutoContinueNudges("List files in src"), 20);
});
