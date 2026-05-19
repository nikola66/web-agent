import test from "node:test";
import assert from "node:assert/strict";

import { shouldRejectPendingToolsFromLoopGuard } from "../dist/agent-runtime/loop-guard.js";

const blogRequest =
  "Research 1bit LLMs topic and write me a blog article about it (Bitnet by Microsoft) check their Github repo";

test("rejects pending tools when NLI says stop with visible prose", () => {
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(
      { decision: "stop", scores: { continue: 0.45, stop: 0.7, ask_user: 0.2 } },
      {
        userRequest: blogRequest,
        webSearchCount: 1,
        webFetchCount: 0,
        visible: "I found the Microsoft BitNet repository and will fetch the readme next.",
        pendingToolNames: ["web_fetch"],
      }
    ),
    true
  );
});

test("rejects pending tools when stop clearly dominates on long final answer", () => {
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(
      { decision: "stop", scores: { continue: 0.2, stop: 0.85, ask_user: 0.1 } },
      {
        userRequest: "What is 2+2?",
        webSearchCount: 0,
        webFetchCount: 0,
        visible:
          "The answer is 4. Here is the complete explanation with all steps finished and nothing else to do.",
        pendingToolNames: ["web_search"],
      }
    ),
    true
  );
});

test("does not reject when model only queued tools with no prose", () => {
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(
      { decision: "stop", scores: { continue: 0.1, stop: 0.9, ask_user: 0.1 } },
      {
        userRequest: blogRequest,
        webSearchCount: 1,
        webFetchCount: 0,
        visible: "",
        pendingToolNames: ["web_fetch", "read_file"],
      }
    ),
    false
  );
});

test("does not reject when NLI says continue", () => {
  assert.equal(
    shouldRejectPendingToolsFromLoopGuard(
      { decision: "continue", scores: { continue: 0.8, stop: 0.2, ask_user: 0.1 } },
      {
        userRequest: blogRequest,
        visible: "Continuing research.",
        pendingToolNames: ["web_fetch"],
      }
    ),
    false
  );
});
