import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDemoPayload,
  demoEventToOpenAiLines,
  isDemoSentinelContent,
  mapDemoHttpError,
  messageContentToText,
  openAiMessagesToDemo,
  parseDemoSseBuffer,
} from "../scripts/bitnet/translate.mjs";

test("messageContentToText extracts string and text parts", () => {
  assert.equal(messageContentToText("hello"), "hello");
  assert.equal(
    messageContentToText([{ type: "text", text: "a" }, { type: "text", text: "b" }]),
    "a\nb"
  );
  assert.equal(messageContentToText([{ type: "image_url", url: "x" }]), null);
});

test("openAiMessagesToDemo maps roles and rejects multimodal user content", () => {
  const ok = openAiMessagesToDemo([
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
  ]);

  const bad = openAiMessagesToDemo([{ role: "user", content: [{ type: "image_url" }] }]);
  assert.equal(bad.ok, false);
});

test("buildDemoPayload builds stable user and chat ids", () => {
  const payload = buildDemoPayload({
    messages: [{ role: "user", content: "test" }],
    profileId: "profile-1",
    sessionId: "session-9",
    device: "cpu",
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.body.userId, "webagent-profile-1");
  assert.equal(payload.body.chatId, "webagent-session-9");
  assert.equal(payload.body.device, "cpu");
});

test("parseDemoSseBuffer translates demo SSE to OpenAI chunks", () => {
  const state = { id: "chatcmpl-test", model: "bitnet-b1.58-2b-4t", finished: false };
  const input = 'data: {"content":"Hel"}\n\ndata: {"content":"lo","finished":true}\n\n';
  const { lines, remainder } = parseDemoSseBuffer(input, state);
  assert.equal(remainder, "");
  assert.ok(lines.some((line) => line.includes('"content":"Hel"')));
  assert.ok(lines.some((line) => line.includes('"finish_reason":"stop"')));
  assert.ok(lines.some((line) => line.includes("data: [DONE]")));
  assert.equal(state.finished, true);
});

test("demoEventToOpenAiLines emits content delta", () => {
  const state = { id: "id1", model: "bitnet-b1.58-2b-4t", finished: false };
  const lines = demoEventToOpenAiLines({ content: "x" }, state);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /"content":"x"/);
});

test("demoEventToOpenAiLines strips demo [DONE] sentinel from content", () => {
  assert.equal(isDemoSentinelContent("[DONE]"), true);
  const state = { id: "id1", model: "bitnet-b1.58-2b-4t", finished: false };
  const lines = demoEventToOpenAiLines(
    { content: "[DONE]", finished: true, generated_tokens: 10 },
    state
  );
  assert.ok(!lines.some((line) => line.includes('"content":"[DONE]"')));
  assert.ok(lines.some((line) => line.includes('"finish_reason":"stop"')));
  assert.ok(lines.some((line) => line.includes("data: [DONE]")));
});

test("mapDemoHttpError maps queue full to 503", () => {
  const mapped = mapDemoHttpError(200, "Task queue is full, please try again later.");
  assert.equal(mapped.status, 503);
});
