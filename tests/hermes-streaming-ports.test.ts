import test from "node:test";
import assert from "node:assert/strict";

import { assembleStreamToolCalls } from "../dist/agent-runtime/llm/streaming.js";
import { StreamingThinkScrubber } from "../dist/agent-runtime/llm/think-scrubber.js";
import {
  shouldContinueThinkingPrefill,
  MAX_THINKING_PREFILL_CONTINUATIONS,
} from "../dist/agent-runtime/turn-continuation.js";
import { dropTrailingEmptyResponseScaffolding } from "../dist/agent-runtime/message-sanitizer.js";
import {
  decideNoToolsContinuation,
  ZERO_CONTINUATION_COUNTS,
} from "./turn-stall-harness.js";

type StreamToolAccEntry = { id: string; name: string; arguments: string };

function nextStreamToolSlot(nextSlot: { value: number }): number {
  return nextSlot.value++;
}

function feedOpenAiStreamPayloadForTest(
  payload: unknown,
  toolAcc: Map<number, StreamToolAccEntry>,
  lastIdAtIdx: Map<number, string>,
  activeSlotByIdx: Map<number, number>,
  nextSlot: { value: number }
) {
  const choices = Array.isArray((payload as { choices?: unknown[] })?.choices)
    ? (payload as { choices: unknown[] }).choices
    : [];
  for (const choice of choices) {
    const delta = (choice as { delta?: Record<string, unknown> })?.delta || {};
    const streamedCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of streamedCalls) {
      const rawIdx = Number.isInteger((call as { index?: number })?.index)
        ? (call as { index: number }).index
        : 0;
      const deltaId = String((call as { id?: string })?.id || "");
      if (!activeSlotByIdx.has(rawIdx)) activeSlotByIdx.set(rawIdx, rawIdx);
      if (deltaId && lastIdAtIdx.has(rawIdx) && lastIdAtIdx.get(rawIdx) !== deltaId) {
        activeSlotByIdx.set(rawIdx, nextStreamToolSlot(nextSlot));
      }
      if (deltaId) lastIdAtIdx.set(rawIdx, deltaId);
      const idx = activeSlotByIdx.get(rawIdx)!;
      const current = toolAcc.get(idx) || { id: "", name: "", arguments: "" };
      const fn = (call as { function?: { name?: string; arguments?: string } })?.function;
      if ((call as { id?: string })?.id) current.id = String((call as { id?: string }).id);
      if (fn?.name) current.name = fn.name;
      if (typeof fn?.arguments === "string") current.arguments += fn.arguments;
      toolAcc.set(idx, current);
    }
  }
}

function createStreamToolAccumulator() {
  return {
    toolAcc: new Map<number, StreamToolAccEntry>(),
    lastIdAtIdx: new Map<number, string>(),
    activeSlotByIdx: new Map<number, number>(),
    nextSlot: { value: 1 },
  };
}

function streamChunk(toolCalls: unknown[], content = "") {
  return {
    choices: [
      {
        delta: {
          content,
          tool_calls: toolCalls,
        },
      },
    ],
  };
}

test("assembleStreamToolCalls repairs truncated JSON arguments", () => {
  const acc = createStreamToolAccumulator();
  feedOpenAiStreamPayloadForTest(
    streamChunk([
      {
        index: 0,
        id: "call_1",
        function: { name: "read_file", arguments: '{"path":"work/article.md"' },
      },
    ]),
    acc.toolAcc,
    acc.lastIdAtIdx,
    acc.activeSlotByIdx,
    acc.nextSlot
  );
  const calls = assembleStreamToolCalls(acc.toolAcc);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "read_file");
  assert.deepEqual(JSON.parse(calls[0]!.arguments), { path: "work/article.md" });
});

test("assembleStreamToolCalls salvages truncated write_file content from partial stream", () => {
  const body = "# Title\n\n" + "Paragraph. ".repeat(80);
  const partialArgs = `{"path":"work/article.md","content":${JSON.stringify(body).slice(0, 120)}`;
  const acc = createStreamToolAccumulator();
  feedOpenAiStreamPayloadForTest(
    streamChunk([
      {
        index: 0,
        id: "call_w",
        function: { name: "write_file", arguments: partialArgs },
      },
    ]),
    acc.toolAcc,
    acc.lastIdAtIdx,
    acc.activeSlotByIdx,
    acc.nextSlot
  );
  const calls = assembleStreamToolCalls(acc.toolAcc);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.name, "write_file");
  const args = JSON.parse(calls[0]!.arguments);
  assert.equal(args.path, "work/article.md");
  assert.ok(String(args.content).length >= 100);
});

test("Ollama parallel tool calls reuse index but separate ids into distinct slots", () => {
  const acc = createStreamToolAccumulator();
  feedOpenAiStreamPayloadForTest(
    streamChunk([
      { index: 0, id: "call_a", function: { name: "read_file", arguments: '{"path":"a"' } },
    ]),
    acc.toolAcc,
    acc.lastIdAtIdx,
    acc.activeSlotByIdx,
    acc.nextSlot
  );
  feedOpenAiStreamPayloadForTest(
    streamChunk([{ index: 0, id: "call_a", function: { arguments: "}" } }]),
    acc.toolAcc,
    acc.lastIdAtIdx,
    acc.activeSlotByIdx,
    acc.nextSlot
  );
  feedOpenAiStreamPayloadForTest(
    streamChunk([
      { index: 0, id: "call_b", function: { name: "list_dir", arguments: '{"path":"."}' } },
    ]),
    acc.toolAcc,
    acc.lastIdAtIdx,
    acc.activeSlotByIdx,
    acc.nextSlot
  );
  const calls = assembleStreamToolCalls(acc.toolAcc);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.name).sort(),
    ["list_dir", "read_file"]
  );
});

test("StreamingThinkScrubber suppresses split thinking tags across deltas", () => {
  const scrubber = new StreamingThinkScrubber();
  assert.equal(scrubber.feed("<thinking>"), "");
  assert.equal(scrubber.feed("secret reasoning"), "");
  assert.equal(scrubber.feed("</thinking>visible answer"), "visible answer");
  assert.equal(scrubber.flush(), "");
});

test("StreamingThinkScrubber extracts thinking text to onReasoningDelta", () => {
  const reasoning: string[] = [];
  const scrubber = new StreamingThinkScrubber({
    onReasoningDelta: (chunk) => reasoning.push(chunk),
  });
  assert.equal(scrubber.feed("<thinking>step one"), "");
  assert.equal(scrubber.feed(" and two</thinking>visible"), "visible");
  assert.equal(reasoning.join(""), "step one and two");
});

test("StreamingThinkScrubber extracts closed thinking pair in one delta", () => {
  const reasoning: string[] = [];
  const scrubber = new StreamingThinkScrubber({
    onReasoningDelta: (chunk) => reasoning.push(chunk),
  });
  assert.equal(scrubber.feed("<reasoning>plan</reasoning>answer"), "answer");
  assert.equal(reasoning.join(""), "plan");
});

test("shouldContinueThinkingPrefill continues reasoning-only empty turns up to cap", () => {
  assert.equal(shouldContinueThinkingPrefill("", true, 0, 0), true);
  assert.equal(
    shouldContinueThinkingPrefill("", true, 0, MAX_THINKING_PREFILL_CONTINUATIONS),
    false
  );
  assert.equal(shouldContinueThinkingPrefill("Done.", true, 0, 0), false);
});

test("decideNoToolsContinuation prefers thinking_prefill over hard stop", () => {
  const decision = decideNoToolsContinuation({
    combined: "",
    visible: "",
    toolsLength: 0,
    executedToolsInTurn: false,
    originalUserInput: "continue working on article",
    conv: [{ role: "user", content: "continue working on article" }],
    runToolCalls: [],
    lastToolExecutions: [],
    counts: ZERO_CONTINUATION_COUNTS,
    sawReasoning: true,
  });
  assert.equal(decision.action, "continue");
  assert.equal(decision.action === "continue" ? decision.kind : "", "thinking_prefill");
});

test("dropTrailingEmptyResponseScaffolding removes thinking prefill scaffolding", () => {
  const cleaned = dropTrailingEmptyResponseScaffolding([
    { role: "user", content: "hello" },
    { role: "assistant", content: "", _thinking_prefill: true },
  ]);
  assert.deepEqual(cleaned, [{ role: "user", content: "hello" }]);
});
