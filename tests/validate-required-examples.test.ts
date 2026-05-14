import test from "node:test";
import assert from "node:assert/strict";

import { validateRequiredArguments } from "../dist/agent-runtime/tools/argument-normalization.js";

test("validateRequiredArguments appends first schema example when fields missing", () => {
  const schema = {
    type: "object",
    properties: {
      key: { type: "string" },
      value: {},
    },
    required: ["key", "value"],
    examples: [{ key: "user_city", value: "Austin" }],
  };
  const err = validateRequiredArguments("memory_save", {}, schema);
  assert.ok(err);
  assert.match(err, /missing required field/);
  assert.match(err, /Example:.*user_city/);
});
