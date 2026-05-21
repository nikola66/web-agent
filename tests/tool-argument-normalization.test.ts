import test from "node:test";
import assert from "node:assert/strict";

import {
  repairMalformedToolArguments,
  coerceWorkspaceBrowsePath,
  applyWorkspaceBrowsePathArgs,
  normalizeToolArguments,
  validateRequiredArguments,
} from "../dist/agent-runtime/tools/argument-normalization.js";

test("repairMalformedToolArguments unwraps quoted keys and values", () => {
  const repaired = repairMalformedToolArguments({
    '"query"': '"Ainex sales outreach plan assets"',
  });
  assert.deepEqual(repaired, { query: "Ainex sales outreach plan assets" });
});

test("repairMalformedToolArguments prefers clean keys over quoted duplicates", () => {
  const repaired = repairMalformedToolArguments({
    '"query"': '"wrong"',
    query: "right",
  });
  assert.equal(repaired.query, "right");
});

test("coerceWorkspaceBrowsePath maps host root to workspace root", () => {
  assert.equal(coerceWorkspaceBrowsePath("/"), ".");
  assert.equal(coerceWorkspaceBrowsePath(""), ".");
  assert.equal(coerceWorkspaceBrowsePath("/workspace"), ".");
  assert.equal(coerceWorkspaceBrowsePath("projects/foo"), "projects/foo");
});

test("applyWorkspaceBrowsePathArgs fixes list_dir path", () => {
  const out = applyWorkspaceBrowsePathArgs("list_dir", { path: "/" });
  assert.equal(out.path, ".");
});

test("normalizeToolArguments repairs session_search query before validation", () => {
  const schema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  };
  const args = normalizeToolArguments({ '"query"': '"Ainex plan"' }, schema, "session_search");
  assert.equal(args.query, "Ainex plan");
  assert.equal(validateRequiredArguments("session_search", args, schema), null);
});

test("normalizeToolArguments coerces list_dir path when toolName provided", () => {
  const schema = {
    type: "object",
    properties: { path: { type: "string" } },
    additionalProperties: true,
  };
  const args = normalizeToolArguments({ path: "/" }, schema, "list_dir");
  assert.equal(args.path, ".");
});
