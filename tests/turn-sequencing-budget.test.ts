import test from "node:test";
import assert from "node:assert/strict";

import {
  repairExactResponseText,
  shouldSuppressActionPlanAutoContinue,
} from "../dist/agent-runtime/turn-sequencing.js";
import {
  resolveMaxAutoContinueNudges,
  shouldSuppressPostToolNudgeFromExecutions,
} from "../dist/agent-runtime/turn-budget.js";

test("topic pivot: explicit lead-in suppresses action-plan auto-continue gate", () => {
  const prev = "Generate a PDF of the SEO plan and email it.";
  assert.equal(
    shouldSuppressActionPlanAutoContinue("Instead, set up a daily LLM news digest at 9am.", prev),
    true
  );
  assert.equal(
    shouldSuppressActionPlanAutoContinue("Forget that — list open issues only.", prev),
    true
  );
});

test("topic pivot: low overlap suppresses; retry same task does not", () => {
  const prev = "You're right, send the SEO audit as a PDF attachment via email.";
  assert.equal(
    shouldSuppressActionPlanAutoContinue(
      "Every morning I need a full report on latest LLM and open-weight model news in chat at 9am.",
      prev
    ),
    true
  );
  assert.equal(shouldSuppressActionPlanAutoContinue("Try again", prev), false);
  assert.equal(shouldSuppressActionPlanAutoContinue("Please retry", prev), false);
});

test("topic pivot: tool-sequence requests are never suppressed", () => {
  const prev = "Summarize the README.";
  const seq =
    "List every tool and test them one by one without stopping until completion.";
  assert.equal(shouldSuppressActionPlanAutoContinue(seq, prev), false);
});

test("repairs exact response tokens when model strips underscores", () => {
  assert.equal(
    repairExactResponseText(
      "Reply with exactly LIVE_DIRECT_OK_TOKEN and no other words.",
      "LIVEDIRECTOK_TOKEN"
    ),
    "LIVE_DIRECT_OK_TOKEN"
  );
  assert.equal(
    repairExactResponseText(
      "Give one final sentence ending with LIST_DONE_TOKEN.",
      "Project files are listed - LISTDONETOKEN"
    ),
    "Project files are listed - LIST_DONE_TOKEN"
  );
});

test("resolveMaxAutoContinueNudges default cap", () => {
  assert.equal(resolveMaxAutoContinueNudges("Fix typo in README"), 20);
});

test("shouldSuppressPostToolNudgeFromExecutions detects nodebox shell blocks", () => {
  assert.equal(
    shouldSuppressPostToolNudgeFromExecutions([
      {
        tool: "run_shell",
        error: "blocked",
        retryable: false,
        error_code: "nodebox_shell_unsupported",
      },
    ]),
    true
  );
  assert.equal(shouldSuppressPostToolNudgeFromExecutions([]), false);
});
