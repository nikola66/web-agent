import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createAssistantTranscriptEvent,
  createReasoningPreviewTranscriptEvent,
  createToolResultTranscriptEvent,
  createTurnSignalTranscriptEvent,
  formatTranscriptEventForChannel,
  shortenReasoningPreview,
  formatSkippedToolsTranscript,
  formatToolResultTranscript,
  formatToolStartTranscript,
} from "../dist/agent-runtime/transcript.js";
import { emitTranscriptEvent } from "../dist/agent-runtime/transcript-delivery.js";

test("transcript formatter mirrors terminal tool lines", () => {
  const cat = { web_search: { emoji: "🌍" }, read_file: { emoji: "📄" } };
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
      toolCatalog: cat,
    }),
    "▸ 🌍 web_search {\"query\":\"UAE Iran\"}"
  );
  assert.equal(formatToolResultTranscript({ name: "web_search", status: "ok" }), "✓ web_search");
  assert.equal(
    formatToolResultTranscript({ name: "web_search", status: "ok", toolCatalog: cat }),
    "✓ 🌍 web_search"
  );
  assert.equal(
    formatToolResultTranscript({ name: "read_file", status: "error", error: "Path not found" }),
    "✗ read_file: Path not found"
  );
  assert.equal(
    formatToolResultTranscript({
      name: "read_file",
      status: "error",
      error: "Path not found",
      toolCatalog: cat,
    }),
    "✗ 📄 read_file: Path not found"
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
    "Opaline\n └ There is no active UAE-Iran war."
  );
});

test("terminal channel transcript includes tool emoji on tool lines", () => {
  const cat = { web_search: { emoji: "🌍" } };
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_start", name: "web_search", argsPreview: '{"q":1}' },
      { style: "terminal", toolCatalog: cat }
    ),
    "▸ 🌍 web_search {\"q\":1}"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_result", name: "web_search", status: "ok" },
      { style: "terminal", toolCatalog: cat }
    ),
    "✓ 🌍 web_search"
  );
});

test("telegram channel transcript omits agent name and tool args", () => {
  const cat = { web_search: { emoji: "🌍" } };
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
    "▸ 🌍 web_search"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      { type: "tool_result", name: "web_search", status: "ok" },
      { style: "telegram", toolCatalog: cat }
    ),
    "✓ 🌍 web_search"
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
      { type: "goal_loop", phase: "continue", goal: "Build feature X" },
      { style: "telegram" }
    ),
    ""
  );
});

test("channel transcript formatter prefers the canonical terminal-rendered body", () => {
  assert.equal(
    formatTranscriptEventForChannel({
      type: "assistant",
      agentName: "Opaline",
      text: "## Result\n- **Done**",
      renderedText: " └ \u001b[36m\u001b[1mResult\u001b[0m\u001b[0m\n• \u001b[1mDone\u001b[0m",
      branchBelowName: true,
    }),
    "Opaline\n └ Result\n• Done"
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

test("reasoning preview transcript formats terminal and telegram styles", () => {
  const long = "alpha ".repeat(40).trim();
  assert.equal(shortenReasoningPreview(long, 24).startsWith("…"), true);
  assert.equal(
    formatTranscriptEventForChannel(
      createReasoningPreviewTranscriptEvent({ text: "Checking file layout" }),
      { style: "terminal" }
    ),
    "💭 Checking file layout"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      createReasoningPreviewTranscriptEvent({ text: "Checking file layout" }),
      { style: "telegram" }
    ),
    "_💭 Checking file layout_"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      createReasoningPreviewTranscriptEvent({ text: "", done: true }),
      { style: "telegram" }
    ),
    ""
  );
});

test("turn signal transcript formats compact channel status lines", () => {
  assert.equal(
    formatTranscriptEventForChannel(
      createTurnSignalTranscriptEvent({ signal: "turn_status", text: "Working…" }),
      { style: "terminal" }
    ),
    ""
  );
  assert.equal(
    formatTranscriptEventForChannel(
      createTurnSignalTranscriptEvent({ signal: "tool_batch_start", toolCount: 3 }),
      { style: "telegram" }
    ),
    "Working: running 3 tools…"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      createTurnSignalTranscriptEvent({ signal: "continuation", reason: "pre_tool_promise" }),
      { style: "terminal" }
    ),
    "Continuing: pre_tool_promise…"
  );
  assert.equal(
    formatTranscriptEventForChannel(
      createTurnSignalTranscriptEvent({ signal: "blocked", reason: "max_rounds" }),
      { style: "telegram" }
    ),
    "Blocked: max_rounds"
  );
});

test("telegram timer status does not suppress identical assistant text", async () => {
  const originalCwd = process.cwd();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "webagent-transcript-"));
  const dispatcherUrl = pathToFileURL(
    path.join(originalCwd, "dist/agent-runtime/channels/dispatcher.js")
  ).href;
  const prevFirst = process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
  const prevRepeat = process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;

  process.chdir(tmp);
  process.env.WEBAGENT_MEMORY_ROOT = path.join(tmp, "memory");
  process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = "20";
  process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = "1000";

  try {
    const { createChannelInboundHandler } = await import(`${dispatcherUrl}?t=${Date.now()}-status-dedupe`);
    const replies = [];
    const inbound = createChannelInboundHandler({
      cfg: {},
      sendReply: async (_chatId, text) => replies.push(text),
      agentTurn: async (_history, _cfg, meta) => {
        await new Promise((resolve) => setTimeout(resolve, 70));
        await meta.onTranscript({
          type: "assistant",
          agentName: "Opaline",
          text: "Working…",
          branchBelowName: true,
        });
        return [{ role: "assistant", content: "Working…" }];
      },
    });

    await inbound({ channel: "telegram", chatId: "123", text: "slow same text" });

    assert.deepEqual(replies, ["Working…", "Working…"]);
  } finally {
    process.chdir(originalCwd);
    delete process.env.WEBAGENT_MEMORY_ROOT;
    if (prevFirst === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_FIRST_MS = prevFirst;
    if (prevRepeat === undefined) delete process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS;
    else process.env.WEBAGENT_CHANNEL_STATUS_REPEAT_MS = prevRepeat;
    await fs.rm(tmp, { recursive: true, force: true });
  }
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
        renderedText: " └ Final answer",
      })
    ),
    /channel unavailable/
  );
});
