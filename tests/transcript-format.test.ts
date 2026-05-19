import test from "node:test";
import assert from "node:assert/strict";

import {
  createAssistantTranscriptEvent,
  createGoalLoopTranscriptEvent,
  createToolResultTranscriptEvent,
  formatTranscriptEventForChannel,
  formatSkippedToolsTranscript,
  formatToolResultTranscript,
  formatToolStartTranscript,
} from "../dist/agent-runtime/transcript.js";
import { emitTranscriptEvent } from "../dist/agent-runtime/transcript-delivery.js";

test("transcript formatter mirrors terminal tool lines", () => {
  assert.equal(
    formatToolStartTranscript({
      name: "web_search",
      argsPreview: "{\"query\":\"UAE Iran\"}",
    }),
    "▸ web_search {\"query\":\"UAE Iran\"}"
  );
  assert.equal(
    formatToolStartTranscript({
      name: "web_search",
      argsPreview: "{\"query\":\"UAE Iran\"}",
      emoji: "🔍",
    }),
    "▸ 🔍 web_search {\"query\":\"UAE Iran\"}"
  );
  assert.equal(formatToolResultTranscript({ name: "web_search", status: "ok" }), "✓ web_search");
  assert.equal(
    formatToolResultTranscript({ name: "web_search", status: "ok", emoji: "🔍" }),
    "✓ 🔍 web_search"
  );
  assert.equal(
    formatToolResultTranscript({ name: "read_file", status: "error", error: "Path not found" }),
    "✗ read_file: Path not found"
  );
});

test("channel transcript formatter includes tool emoji on terminal surfaces", () => {
  const cat = { web_search: { emoji: "🔍" } };
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_start", name: "web_search", argsPreview: '{"q":1}' },
      { style: "terminal", toolCatalog: cat }
    ),
    "▸ 🔍 web_search {\"q\":1}"
  );
});

test("channel transcript formatter includes assistant name and branch prefix", () => {
  assert.equal(
    formatTranscriptEventForChannel({
      type: "assistant",
      agentName: "Opaline",
      text: "There is no active UAE-Iran war.",
      branchBelowName: true,
    }),
    "Opaline\n ⎿ There is no active UAE-Iran war."
  );
});

test("telegram channel transcript omits agent name and tool args", () => {
  const cat = { web_search: { emoji: "🔍" } };
  assert.equal(
    formatTranscriptEventForChannel(
      {
        type: "assistant",
        agentName: "Indara",
        text: "Hello **world**",
        branchBelowName: true,
      },
      { style: "telegram" }
    ),
    "Hello **world**"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_start", name: "web_search", argsPreview: '{"q":1}' },
      { style: "telegram", toolCatalog: cat }
    ),
    "▸ 🔍 web_search"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_result", name: "web_search", status: "ok" },
      { style: "telegram", toolCatalog: cat }
    ),
    "✓ 🔍 web_search"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "system_line", text: "▸ skipped 1 invalid tool call(s): x" },
      { style: "telegram" }
    ),
    ""
  );

  assert.equal(
    formatTranscriptEventForChannel(
      createGoalLoopTranscriptEvent({
        phase: "continue",
        goal: "Build feature X",
        continuationsUsed: 3,
        maxContinuations: 20,
      }),
      { style: "telegram" }
    ).startsWith("◇ Plan goal · continuing (3/20)"),
    true
  );
});

test("goal_loop transcript renders on terminal surfaces", () => {
  assert.match(
    formatTranscriptEventForChannel(createGoalLoopTranscriptEvent({
      phase: "invoked",
      goal: "Doc refresh",
      maxContinuations: 20,
    })),
    /Plan goal · active/
  );
});

test("channel transcript formatter prefers the canonical terminal-rendered body", () => {
  assert.equal(
    formatTranscriptEventForChannel({
      type: "assistant",
      agentName: "Opaline",
      text: "## Result\n- **Done**",
      renderedText: " ⎿ \u001b[36m\u001b[1mResult\u001b[0m\u001b[0m\n• \u001b[1mDone\u001b[0m",
      branchBelowName: true,
    }),
    "Opaline\n ⎿ Result\n• Done"
  );
});

test("skipped tool call transcript uses one canonical formatter", () => {
  assert.equal(
    formatSkippedToolsTranscript([
      { reason: "invalid_json" },
      { reason: "unknown_tool" },
    ]),
    "▸ skipped 2 invalid tool call(s): invalid_json, unknown_tool"
  );
});

test("transcript delivery helper swallows non-critical failures and propagates assistant failures", async () => {
  const fail = async () => {
    throw new Error("channel unavailable");
  };

  const nonCritical = await emitTranscriptEvent(
    fail,
    createToolResultTranscriptEvent({ name: "web_search", status: "ok" })
  );
  assert.equal(nonCritical.delivered, false);
  assert.match(nonCritical.error.message, /channel unavailable/);

  await assert.rejects(
    () => emitTranscriptEvent(
      fail,
      createAssistantTranscriptEvent({
        agentName: "Opaline",
        text: "Final answer",
        renderedText: " ⎿ Final answer",
      })
    ),
    /channel unavailable/
  );
});
