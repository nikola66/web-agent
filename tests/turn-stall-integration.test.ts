import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTINUATION_ACTIVE_TOOL_NAMES,
  TURN_STALL_CONTINUATION_SCENARIOS,
  TURN_STALL_PARSE_SCENARIOS,
} from "./fixtures/turn-stall-scenarios.js";
import {
  decideNoToolsContinuation,
  parseAssistantToolRound,
  ZERO_CONTINUATION_COUNTS,
} from "./turn-stall-harness.js";
import {
  shouldDeferTruncatedContentToolExecution,
  partitionToolsForTruncatedContentDeferral,
} from "../dist/agent-runtime/turn-continuation.js";

test("turn-stall parse scenarios extract tools instead of stalling with zero tools", () => {
  const failures: string[] = [];
  for (const scenario of TURN_STALL_PARSE_SCENARIOS) {
    try {
      const parsed = parseAssistantToolRound(scenario.combined, scenario.activeToolNames);
      assert.ok(parsed.tools.length > 0, `${scenario.id}: expected parsed tools`);
      const minTools = scenario.minTools ?? 1;
      assert.ok(
        parsed.tools.length >= minTools,
        `${scenario.id}: expected at least ${minTools} tools, got ${parsed.tools.length}`
      );
      for (const expectedName of scenario.expectToolNames) {
        assert.ok(
          parsed.tools.some((tool) => tool.name === expectedName),
          `${scenario.id}: missing tool ${expectedName}`
        );
      }
    } catch (err) {
      failures.push(`${scenario.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length) assert.fail(failures.join("\n"));
});

test("turn-stall continuation scenarios fire expected recovery instead of hard stop", () => {
  const failures: string[] = [];
  for (const scenario of TURN_STALL_CONTINUATION_SCENARIOS) {
    try {
      const combined = scenario.combined || scenario.visible;
      const activeToolNames =
        scenario.id === "unparsed_dsml_fallback"
          ? CONTINUATION_ACTIVE_TOOL_NAMES
          : ["browse_workspace", "read_file", "skill"];
      const parsed = parseAssistantToolRound(combined, activeToolNames);
      const visible = scenario.visible || parsed.visible;
      const decision = decideNoToolsContinuation({
        combined,
        visible,
        toolsLength: parsed.tools.length,
        executedToolsInTurn: scenario.executedToolsInTurn,
        originalUserInput: scenario.userInput,
        conv: [{ role: "user", content: scenario.userInput }],
        runToolCalls: scenario.runToolCalls,
        lastToolExecutions: scenario.lastToolExecutions || [],
        counts: ZERO_CONTINUATION_COUNTS,
        todoStats: scenario.todoStats,
      });

      if (scenario.expectContinuationKind === "none") {
        assert.equal(decision.action, "stop");
        continue;
      }

      assert.equal(decision.action, "continue", `${scenario.id}: expected continuation`);
      assert.equal(
        decision.action === "continue" ? decision.kind : "",
        scenario.expectContinuationKind,
        `${scenario.id}: wrong continuation kind`
      );
    } catch (err) {
      failures.push(`${scenario.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failures.length) assert.fail(failures.join("\n"));
});

test("promise-only assistant text continues instead of no_tools_no_continue", () => {
  const visible =
    "Let me read the article and the publisher script so I can show you what we're working with.";
  const decision = decideNoToolsContinuation({
    combined: visible,
    visible,
    toolsLength: 0,
    executedToolsInTurn: false,
    originalUserInput: "continue working on article",
    conv: [{ role: "user", content: "continue working on article" }],
    runToolCalls: [],
    lastToolExecutions: [],
    counts: ZERO_CONTINUATION_COUNTS,
  });
  assert.equal(decision.action, "continue");
  assert.equal(decision.action === "continue" ? decision.kind : "", "pre_tool_promise");
});

test("reasoning-only empty turn continues via thinking_prefill instead of hard stop", () => {
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

test("length finish with write_file defers execution instead of writing partial content", () => {
  const tools = [
    {
      name: "write_file",
      arguments: {
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: '---\ntitle: "BitNet"\npublished_at: "2026-05-29T20',
      },
    },
  ];
  assert.equal(shouldDeferTruncatedContentToolExecution("length", tools, 0), true);
  assert.equal(shouldDeferTruncatedContentToolExecution("stop", tools, 0), false);
});

test("length finish defers write_file but still runs read_file in same batch", () => {
  const tools = [
    { name: "read_file", arguments: { path: "work/bitnet-article/bitnet-b1-58-2b4t.md" } },
    {
      name: "write_file",
      arguments: {
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: '---\ntitle: "BitNet"\npublished_at: "2026-05-29T20',
      },
    },
  ];
  const { defer, run } = partitionToolsForTruncatedContentDeferral("length", tools, 0);
  assert.equal(defer.length, 1);
  assert.equal(run.length, 1);
  assert.equal(run[0]?.name, "read_file");
});
