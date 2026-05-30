import test from "node:test";
import assert from "node:assert/strict";

import { stripReasoningPreviewFromStream } from "../src/agent/runtime/reasoning-preview-ipc.js";
import { liveMirrorVisibleGap } from "../src/agent/runtime/llm/streaming.js";

const START = "<<<WEBAGENT_REASONING_PREVIEW>>>";
const END = "<<<END_WEBAGENT_REASONING_PREVIEW>>>";

test("reasoning preview strip passes through trailing visible text after marker", () => {
  const payload = JSON.stringify({ text: "thinking", done: false });
  const chunk = `We need${START}${payload}${END} to finish the todos.`;
  const previews: Array<{ text: string; done: boolean }> = [];
  const out = stripReasoningPreviewFromStream("", chunk, (p) => previews.push(p));
  assert.equal(out.data, "We need to finish the todos.");
  assert.equal(out.nextCarry, "");
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.text, "thinking");
});

test("reasoning preview strip holds incomplete marker without blocking prior text", () => {
  const part1 = `We need${START}{\"text\":\"x\"`;
  const part2 = `,\"done\":false}${END} more`;
  const previews: Array<{ text: string; done: boolean }> = [];
  const first = stripReasoningPreviewFromStream("", part1, (p) => previews.push(p));
  assert.equal(first.data, "We need");
  assert.ok(first.nextCarry.includes(START));
  const second = stripReasoningPreviewFromStream(first.nextCarry, part2, (p) => previews.push(p));
  assert.equal(second.data, " more");
  assert.equal(second.nextCarry, "");
  assert.equal(previews.length, 1);
});

test("liveMirrorVisibleGap appends sanitized suffix missing from streamed mirror", () => {
  assert.equal(liveMirrorVisibleGap("We need", "We need to finish the todos."), " to finish the todos.");
  assert.equal(liveMirrorVisibleGap("Hey", "Hey"), "");
});
