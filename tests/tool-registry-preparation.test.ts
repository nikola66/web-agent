import test from "node:test";
import assert from "node:assert/strict";

import { prepareIncomingToolArguments, BUILTIN_TOOLS } from "../dist/agent-runtime/tools/registry.js";
import { validateRequiredArguments, resolveInputSchema } from "../dist/agent-runtime/tools/argument-normalization.js";

const SESSION_TOOLS = ["session_search", "session_memory_append", "session_memory_list"] as const;
const BROWSE_TOOLS = ["list_dir", "grep", "tree", "find_files"] as const;

test("prepareIncomingToolArguments repairs session_search quoted keys", () => {
  const { args } = prepareIncomingToolArguments(
    "session_search",
    '{"\\"query\\"":"\\"Ainex outreach\\""}',
    BUILTIN_TOOLS.session_search
  );
  assert.equal(args.query, "Ainex outreach");
  const schema = resolveInputSchema(BUILTIN_TOOLS.session_search);
  assert.equal(validateRequiredArguments("session_search", args, schema), null);
});

for (const tool of SESSION_TOOLS) {
  test(`prepareIncomingToolArguments accepts empty object for ${tool} when optional`, () => {
    const entry = BUILTIN_TOOLS[tool as keyof typeof BUILTIN_TOOLS];
    const { args } = prepareIncomingToolArguments(tool, {}, entry);
    assert.ok(args && typeof args === "object");
  });
}

for (const tool of BROWSE_TOOLS) {
  test(`prepareIncomingToolArguments coerces / to . for ${tool}`, () => {
    const entry = BUILTIN_TOOLS[tool as keyof typeof BUILTIN_TOOLS];
    const pathKey = tool === "grep" || tool === "find_files" ? "root" : "path";
    const { args } = prepareIncomingToolArguments(tool, { [pathKey]: "/" }, entry);
    assert.equal(args[pathKey], ".");
  });
}

test("prepareIncomingToolArguments normalizes find_files patterns array", () => {
  const { args } = prepareIncomingToolArguments(
    "find_files",
    '{"patterns":["ainex","outreach"],"root":"/"}',
    BUILTIN_TOOLS.find_files
  );
  assert.deepEqual(args.patterns, ["ainex", "outreach"]);
  assert.equal(args.root, ".");
});

test("prepareIncomingToolArguments strips glob stars and keeps matchMode any", () => {
  const { args } = prepareIncomingToolArguments(
    "find_files",
    '{"patterns":["*outreach*","*sequence*"],"matchMode":"any","root":"/"}',
    BUILTIN_TOOLS.find_files
  );
  assert.deepEqual(args.patterns, ["outreach", "sequence"]);
  assert.equal(args.matchMode, "any");
});
