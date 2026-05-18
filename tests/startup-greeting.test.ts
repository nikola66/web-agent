import test from "node:test";
import assert from "node:assert/strict";

import {
  extractGreetingTranscriptMessages,
  isStartupGreetingNoise,
  mergeStartupGreetingContextLines,
} from "../dist/agent-runtime/bootstrap.js";

test("isStartupGreetingNoise filters boot markers and empty content", () => {
  assert.equal(isStartupGreetingNoise(""), true);
  assert.equal(isStartupGreetingNoise("(session opened)"), true);
  assert.equal(
    isStartupGreetingNoise("Session startup — you speak first.\nPRIOR_CONTEXT:\nfoo"),
    true
  );
  assert.equal(isStartupGreetingNoise("Finish wiring the auth middleware"), false);
});

test("extractGreetingTranscriptMessages keeps recent real chat from saved history", () => {
  const history = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "(session opened)" },
    {
      role: "assistant",
      content: "Welcome back! Ready when you are.",
    },
    { role: "user", content: "Let's finish the onboarding flow tests." },
    {
      role: "assistant",
      content: "I'll pick up the failing signup spec next.",
    },
    {
      role: "user",
      content: "Session startup — you speak first.\nPRIOR_CONTEXT:\nignored",
    },
  ];

  const transcript = extractGreetingTranscriptMessages(history, 6);
  assert.deepEqual(transcript, [
    {
      role: "assistant",
      content: "Welcome back! Ready when you are.",
    },
    { role: "user", content: "Let's finish the onboarding flow tests." },
    {
      role: "assistant",
      content: "I'll pick up the failing signup spec next.",
    },
  ]);
});

test("mergeStartupGreetingContextLines clips oversized context", () => {
  const merged = mergeStartupGreetingContextLines(["a".repeat(50), "b".repeat(50)], 80);
  assert.equal(merged.length, 80);
  assert.ok(merged.endsWith("…"));
});
