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

test("prepareIncomingToolArguments maps grep query alias to pattern", () => {
  const { args } = prepareIncomingToolArguments(
    "grep",
    { query: "TODO|FIXME", root: "/" },
    BUILTIN_TOOLS.grep
  );
  assert.equal(args.pattern, "TODO|FIXME");
  assert.equal(args.root, ".");
  assert.equal("query" in args, false);
  const schema = resolveInputSchema(BUILTIN_TOOLS.grep);
  assert.equal(validateRequiredArguments("grep", args, schema), null);
});

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

test("prepareIncomingToolArguments maps web_post endpoint and payload aliases", () => {
  const { args } = prepareIncomingToolArguments(
    "web_post",
    {
      endpoint: "https://hub.aratech.ae/items/Blog_Posts",
      payload: { status: "draft", author: 1 },
      headers: { Authorization: "Bearer tok" },
    },
    BUILTIN_TOOLS.web_post
  );
  assert.equal(args.url, "https://hub.aratech.ae/items/Blog_Posts");
  assert.equal(args.body, '{"status":"draft","author":1}');
  const schema = resolveInputSchema(BUILTIN_TOOLS.web_post);
  assert.equal(validateRequiredArguments("web_post", args, schema), null);
});

test("prepareIncomingToolArguments maps web_post json alias", () => {
  const { args } = prepareIncomingToolArguments(
    "web_post",
    {
      url: "https://api.example.com/items/posts",
      json: { title: "Hello" },
    },
    BUILTIN_TOOLS.web_post
  );
  assert.equal(args.body, '{"title":"Hello"}');
});

test("prepareIncomingToolArguments validates web_post DELETE with url only", () => {
  const { args } = prepareIncomingToolArguments(
    "web_post",
    { url: "https://api.example.com/items/posts/42", method: "DELETE" },
    BUILTIN_TOOLS.web_post
  );
  const schema = resolveInputSchema(BUILTIN_TOOLS.web_post);
  assert.equal(validateRequiredArguments("web_post", args, schema), null);
});

test("prepareIncomingToolArguments preserves web_post method PATCH", () => {
  const { args } = prepareIncomingToolArguments(
    "web_post",
    {
      url: "https://api.example.com/items/posts/42",
      method: "PATCH",
      body: '{"status":"published"}',
    },
    BUILTIN_TOOLS.web_post
  );
  assert.equal(args.method, "PATCH");
});

test("prepareIncomingToolArguments maps run_shell cmd alias to command", () => {
  const { args } = prepareIncomingToolArguments(
    "run_shell",
    { cmd: "node --version" },
    BUILTIN_TOOLS.run_shell
  );
  assert.equal(args.command, "node --version");
  const schema = resolveInputSchema(BUILTIN_TOOLS.run_shell);
  assert.equal(validateRequiredArguments("run_shell", args, schema), null);
});
