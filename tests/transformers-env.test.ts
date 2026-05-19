import test from "node:test";
import assert from "node:assert/strict";

import {
  LOOP_GUARD_MODEL_PATH,
  formatTransformersError,
} from "../src/agent/supervisor/transformers-env.ts";

test("formatTransformersError adds context for numeric ONNX codes", () => {
  const formatted = formatTransformersError(66250952);
  assert.match(formatted, /ONNX Runtime Web error 66250952/);
  assert.match(formatted, /\/models\/loop-guard/);
});

test("LOOP_GUARD_MODEL_PATH points at vendored public assets", () => {
  assert.equal(LOOP_GUARD_MODEL_PATH, "/models/loop-guard");
});

test("formatTransformersError preserves Error messages", () => {
  assert.equal(formatTransformersError(new Error("model load failed")), "model load failed");
});
