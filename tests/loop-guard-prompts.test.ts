import test from "node:test";
import assert from "node:assert/strict";

import { buildSupervisorPremise } from "../src/agent/supervisor/prompts.ts";

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
