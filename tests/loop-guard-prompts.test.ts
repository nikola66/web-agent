import test from "node:test";
import assert from "node:assert/strict";

import {
  LOOP_GUARD_PREMISE_MAX_CHARS,
  buildSupervisorPremise,
  tailText,
} from "../src/agent/supervisor/prompts.ts";

test("buildSupervisorPremise keeps only last N messages", () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg-${i}`,
  }));
  const premise = buildSupervisorPremise(messages, 6);
  assert.match(premise, /msg-4/);
  assert.match(premise, /msg-9/);
  assert.doesNotMatch(premise, /msg-0/);
  assert.doesNotMatch(premise, /msg-3/);
});

test("buildSupervisorPremise labels roles and includes meta", () => {
  const premise = buildSupervisorPremise(
    [{ role: "user", content: "Build a page" }, { role: "assistant", content: "Done." }],
    6,
    {
      userRequest: "Build a page",
      webSearchCount: 2,
      toolsExecutedInTurn: true,
      pendingToolCalls: ["web_fetch"],
    }
  );
  assert.match(premise, /^Last messages:/m);
  assert.match(premise, /User: Build a page/);
  assert.match(premise, /Agent: Done\./);
  assert.match(premise, /user_request: Build a page/);
  assert.match(premise, /web_search_count: 2/);
  assert.match(premise, /tools_executed_this_turn: true/);
  assert.match(premise, /pending_tool_calls: web_fetch/);
});

test("buildSupervisorPremise keeps message tails not heads", () => {
  const content = `START-OF-MSG${"H".repeat(600)}END-MARKER`;
  const premise = buildSupervisorPremise([{ role: "assistant", content }]);
  assert.doesNotMatch(premise, /START-OF-MSG/);
  assert.match(premise, /END-MARKER/);
});

test("buildSupervisorPremise stays within MobileBERT char budget", () => {
  const messages = Array.from({ length: 6 }, () => ({
    role: "assistant",
    content: "x".repeat(5000),
  }));
  const premise = buildSupervisorPremise(messages, 6, {
    userRequest: "y".repeat(500),
    pendingToolCalls: ["read_file", "web_fetch"],
  });
  assert.ok(premise.length <= LOOP_GUARD_PREMISE_MAX_CHARS);
});

test("tailText preserves short strings", () => {
  assert.equal(tailText("hello", 10), "hello");
  assert.equal(tailText("hello world", 5), "…world");
});
