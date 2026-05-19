import test from "node:test";
import assert from "node:assert/strict";

import Fastify from "fastify";
import { judgeTurn } from "../src/turn-judge.js";

test("OPTIONS /judge answers CORS preflight", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "content-type");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
  app.post("/judge", async () => ({ action: "stop" }));
  const res = await app.inject({ method: "OPTIONS", url: "/judge" });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  await app.close();
});

test("hard safety stops in text-only mode", async () => {
  const r = await judgeTurn({
    messages: [{ role: "assistant", content: "Hi" }],
    toolState: {
      executedToolsInTurn: false,
      lastToolNames: [],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 0,
    },
    runtimeState: {
      round: 1,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: true,
      planMode: false,
    },
  });
  assert.equal(r.action, "stop");
  assert.equal(r.source, "safety");
});

test("topic pivot safety stops before model when suppressTopicPivot set", async () => {
  const r = await judgeTurn({
    messages: [
      { role: "user", content: "Instead, list open issues only." },
      { role: "assistant", content: "I'll start by scanning the repo." },
    ],
    toolState: {
      executedToolsInTurn: false,
      lastToolNames: [],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 0,
    },
    runtimeState: {
      round: 1,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: false,
      planMode: false,
      suppressTopicPivot: true,
    },
  });
  assert.equal(r.action, "stop");
  assert.equal(r.source, "safety");
  assert.equal(r.reason, "topic_pivot");
});

test("fallback continues mid-task narration after tools when classifier unavailable", async () => {
  const r = await judgeTurn({
    messages: [
      { role: "user", content: "Continue the marketing outreach plan" },
      {
        role: "assistant",
        content:
          "Now that the workspace is ready, I'm drafting the core outreach strategy. I'm creating a strategy.md with the target segments.",
      },
    ],
    toolState: {
      executedToolsInTurn: true,
      lastToolNames: ["make_dir"],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 1,
    },
    runtimeState: {
      round: 2,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: false,
      planMode: false,
    },
  });
  assert.equal(r.action, "continue");
  assert.match(r.reason, /mid_task_continuation/);
});

test("assistant question stops via safety before model", async () => {
  const r = await judgeTurn({
    messages: [
      { role: "user", content: "continue" },
      {
        role: "assistant",
        content:
          "I'm on it. Which specific thread are we pulling on? Give me the topic or the last thing we were digging into.",
      },
    ],
    toolState: {
      executedToolsInTurn: false,
      lastToolNames: [],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 0,
    },
    runtimeState: {
      round: 1,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: false,
      planMode: false,
    },
  });
  assert.equal(r.action, "stop");
  assert.equal(r.source, "safety");
  assert.equal(r.reason, "assistant_question");
});

test("fallback continues after tools when assistant visible is empty", async () => {
  const r = await judgeTurn({
    messages: [
      { role: "user", content: "run tools" },
      { role: "assistant", content: "" },
    ],
    toolState: {
      executedToolsInTurn: true,
      lastToolNames: ["list_dir"],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 1,
    },
    runtimeState: {
      round: 2,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: false,
      planMode: false,
    },
  });
  assert.equal(r.action, "continue");
  assert.equal(r.source, "fallback");
});
