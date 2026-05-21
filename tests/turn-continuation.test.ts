import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikeIntermediateAck,
  looksLikeEmptyAfterTools,
  buildContinuationNudge,
  shouldContinueIntermediateAck,
  shouldContinueEmptyAfterTools,
  MAX_INTERMEDIATE_ACK_CONTINUATIONS,
} from "../dist/agent-runtime/turn-continuation.js";

test("looksLikeIntermediateAck detects narration without tools", () => {
  assert.equal(looksLikeIntermediateAck("Starting the search now."), true);
  assert.equal(looksLikeIntermediateAck("I'm installing the skills now."), true);
  assert.equal(looksLikeIntermediateAck("Executing the fetch now."), true);
});

test("looksLikeIntermediateAck detects post-tool promise to continue", () => {
  assert.equal(looksLikeIntermediateAck("Starting the hunt now."), true);
  assert.equal(
    looksLikeIntermediateAck(
      `${"x".repeat(2000)}\n\nStarting the hunt now.`
    ),
    true
  );
});

test("looksLikeIntermediateAck rejects vague post-tool lines without action", () => {
  assert.equal(looksLikeIntermediateAck("Let me know if you have questions."), false);
});

test("looksLikeIntermediateAck rejects genuine final answers", () => {
  assert.equal(
    looksLikeIntermediateAck(
      "Here is the SEO audit summary with five prioritized fixes."
    ),
    false
  );
});

test("looksLikeEmptyAfterTools detects empty post-tool responses", () => {
  assert.equal(looksLikeEmptyAfterTools("", true), true);
  assert.equal(looksLikeEmptyAfterTools("   ", true), true);
  assert.equal(looksLikeEmptyAfterTools("Done.", true), false);
  assert.equal(looksLikeEmptyAfterTools("", false), false);
});

test("buildContinuationNudge returns expected recovery text", () => {
  assert.match(buildContinuationNudge("intermediate_ack"), /Continue now/i);
  assert.match(buildContinuationNudge("empty_after_tools"), /empty response/i);
});

test("shouldContinueIntermediateAck respects cap", () => {
  assert.equal(
    shouldContinueIntermediateAck("Starting now.", MAX_INTERMEDIATE_ACK_CONTINUATIONS),
    false
  );
  assert.equal(shouldContinueIntermediateAck("Starting now.", 0), true);
});

test("shouldContinueEmptyAfterTools respects cap", () => {
  assert.equal(shouldContinueEmptyAfterTools("", true, 1), false);
  assert.equal(shouldContinueEmptyAfterTools("", true, 0), true);
});
