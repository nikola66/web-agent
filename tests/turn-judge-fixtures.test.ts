import test from "node:test";
import assert from "node:assert/strict";

import { buildTurnJudgePayload } from "../dist/agent-runtime/turn-judge-payload.js";
import {
  isTurnJudgeEnabled,
  resolveTurnJudgeRuntimeFlags,
  resolveTurnJudgeUrl,
  TURN_JUDGE_DEFAULT_URL,
} from "../dist/agent-runtime/turn-judge-client.js";

test("turn judge is enabled by default with default URL", () => {
  const prev = process.env.WEBAGENT_TURN_JUDGE;
  const prevUrl = process.env.TURN_JUDGE_URL;
  try {
    delete process.env.WEBAGENT_TURN_JUDGE;
    delete process.env.TURN_JUDGE_URL;
    delete process.env.WEBAGENT_APP_ORIGIN;
    assert.equal(resolveTurnJudgeUrl(), TURN_JUDGE_DEFAULT_URL);
    process.env.WEBAGENT_APP_ORIGIN = "http://localhost:5173";
    assert.equal(resolveTurnJudgeUrl(), "http://localhost:5173/api/turn-judge");
    assert.equal(isTurnJudgeEnabled(), true);
    assert.equal(resolveTurnJudgeRuntimeFlags().enabled, true);
    assert.equal(resolveTurnJudgeRuntimeFlags().shadowOnly, false);
    process.env.WEBAGENT_TURN_JUDGE = "0";
    assert.equal(isTurnJudgeEnabled(), false);
    assert.equal(resolveTurnJudgeRuntimeFlags().shadowOnly, false);
    process.env.WEBAGENT_TURN_JUDGE_SHADOW = "1";
    assert.equal(resolveTurnJudgeRuntimeFlags().shadowOnly, true);
  } finally {
    if (prev === undefined) delete process.env.WEBAGENT_TURN_JUDGE;
    else process.env.WEBAGENT_TURN_JUDGE = prev;
    if (prevUrl === undefined) delete process.env.TURN_JUDGE_URL;
    else process.env.TURN_JUDGE_URL = prevUrl;
    delete process.env.WEBAGENT_APP_ORIGIN;
    delete process.env.WEBAGENT_TURN_JUDGE_SHADOW;
  }
});

test("buildTurnJudgePayload keeps bounded messages and tool metadata", () => {
  const conv = [
    { role: "system", content: "x" },
    { role: "user", content: "hello" },
    { role: "assistant", content: "partial" },
    { role: "user", content: "next" },
    { role: "assistant", content: "done for now" },
  ];
  const payload = buildTurnJudgePayload({
    conv,
    executedToolsInTurn: true,
    autoContinueNudges: 1,
    maxAutoContinueNudges: 20,
    webSearchCountInTurn: 2,
    webFetchCountInTurn: 1,
    lastToolExecutions: [{ tool: "web_search", error: undefined }],
    pendingToolNames: ["read_file"],
    round: 3,
    maxRounds: 64,
    textOnly: false,
    planMode: false,
    approvedPlanGoal: null,
    totalToolCallsInTurn: 5,
  });
  assert.ok(payload.messages.every((m) => m.role === "user" || m.role === "assistant"));
  assert.equal(payload.toolState.executedToolsInTurn, true);
  assert.equal(payload.toolState.pendingToolNames?.[0], "read_file");
  assert.equal(payload.runtimeState.round, 3);
});
