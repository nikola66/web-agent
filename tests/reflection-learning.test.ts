import test from "node:test";
import assert from "node:assert/strict";

import { createReflectionFromRun, derivePromotableLearning } from "../dist/agent-runtime/reflection.js";

test("reflection classifies validation-heavy runs with targeted improvement text", () => {
  const run = {
    id: "run_validation",
    status: "completed",
    tool_calls: [{ name: "write_file" }],
    tool_results: [
      { tool: "write_file", error: "invalid arguments: missing required field(s) [path] for write_file" },
    ],
    rejected_tool_calls: [],
    errors: [],
  };
  const reflection = createReflectionFromRun(run);
  assert.equal(reflection.failure_categories.validation, 1);
  assert.match(reflection.improvement, /Validate required tool arguments/);
  const learning = derivePromotableLearning(run, reflection.failure_categories);
  assert.equal(learning?.category, "tool_validation");
});

test("reflection derives positive strategy learning on successful multi-tool runs", () => {
  const run = {
    id: "run_success",
    status: "completed",
    tool_calls: [{ name: "list_dir" }, { name: "read_file" }, { name: "grep" }],
    tool_results: [
      { tool: "list_dir", result: { ok: true } },
      { tool: "read_file", result: { ok: true } },
      { tool: "grep", result: { ok: true } },
    ],
    rejected_tool_calls: [],
    errors: [],
  };
  const reflection = createReflectionFromRun(run);
  const learning = derivePromotableLearning(run, reflection.failure_categories);
  assert.ok(reflection.confidence >= 0.8);
  assert.equal(learning?.category, "tool_strategy");
});
