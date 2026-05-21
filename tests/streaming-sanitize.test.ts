import test from "node:test";
import assert from "node:assert/strict";

import {
  createToolAwareStreamWriter,
  extractClarifyMarkers,
  extractPlainToolCommandLines,
  extractJsonToolCallPayloads,
  normalizeToolCalls,
  sanitizeAssistantVisibleText,
  stripPseudoToolCallLines,
  stripReasoningPlaceholderLines,
} from "../dist/agent-runtime/llm/streaming.js";

test("sanitizeAssistantVisibleText strips pseudo tool lines when names provided", () => {
  const raw = `I'll scan the tree.

list_dir{"path":"."}

list_dir{"path":"projects"}

More prose here.`;
  const out = sanitizeAssistantVisibleText(raw, ["list_dir", "read_file"]);
  assert.ok(out.includes("More prose"));
  assert.ok(out.includes("I'll scan"));
  assert.ok(!out.includes('list_dir{"path":"."}'));
  assert.ok(!out.includes('list_dir{"path":"projects"}'));
});

test("stripPseudoToolCallLines strips toolish lines; keeps normal prose", () => {
  const raw = `custom_fn is just prose on this line
list_dir{"path":"."}`;
  const out = stripPseudoToolCallLines(raw, ["list_dir"]);
  assert.ok(out.includes("custom_fn is just prose"));
  assert.ok(!out.includes('list_dir{"path":"."}'));
});

test("sanitizeAssistantVisibleText strips generic pseudo lines even without tool names", () => {
  const raw = `list_dir{"path":"."}`;
  assert.equal(sanitizeAssistantVisibleText(raw), "");
});

test("strips camelCase typo tool names like readfile when sanitizing with tool list", () => {
  const raw = `Intro line.

readfile{"path":"projects/hermes/HERMES_RESEARCH.md"}

Outro.`;
  const out = sanitizeAssistantVisibleText(raw, ["read_file", "list_dir"]);
  assert.ok(out.includes("Intro"));
  assert.ok(out.includes("Outro"));
  assert.ok(!out.includes("readfile{"));
});

test("extractJsonToolCallPayloads parses plain JSON tool objects from model text", () => {
  const raw = `Current time: 2025-06-17T03:09:26.685Z

{
  "tool": "make_dir",
  "arguments": {
    "path": "fastapi_project"
  }
}`;
  const parsed = extractJsonToolCallPayloads(raw, ["make_dir", "write_file"]);
  assert.deepEqual(parsed.tools, [
    { name: "make_dir", arguments: { path: "fastapi_project" } },
  ]);
  assert.ok(parsed.visible.includes("Current time"));
  assert.ok(!parsed.visible.includes('"tool": "make_dir"'));
});

test("extractJsonToolCallPayloads handles nested JSON strings in arguments", () => {
  const raw = `{
  "tool": "write_file",
  "arguments": {
    "path": "fastapi_project/main.py",
    "content": "def readroot():\\n    return {\\"message\\": \\"Hello World\\"}"
  }
}`;
  const parsed = extractJsonToolCallPayloads(raw, ["write_file"]);
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, "write_file");
  assert.equal(parsed.tools[0].arguments.path, "fastapi_project/main.py");
  assert.ok(parsed.tools[0].arguments.content.includes('"Hello World"'));
  assert.equal(sanitizeAssistantVisibleText(raw, ["write_file"]), "");
});

test("extractJsonToolCallPayloads ignores unknown tool JSON", () => {
  const raw = `{"tool":"not_a_tool","arguments":{"path":"x"}}`;
  const parsed = extractJsonToolCallPayloads(raw, ["make_dir"]);
  assert.deepEqual(parsed.tools, []);
  assert.equal(parsed.visible, raw);
});

test("extractPlainToolCommandLines parses whole-line tool path commands", () => {
  const raw = `I'll list it.
list_dir projects/live-quality-fastapi
Done.`;
  const parsed = extractPlainToolCommandLines(raw, ["list_dir", "read_file"]);
  assert.deepEqual(parsed.tools, [
    { name: "list_dir", arguments: { path: "projects/live-quality-fastapi" } },
  ]);
  assert.ok(parsed.visible.includes("I'll list it."));
  assert.ok(parsed.visible.includes("Done."));
  assert.ok(!parsed.visible.includes("list_dir projects"));
});

test("sanitizeAssistantVisibleText strips whole-line plain tool commands", () => {
  assert.equal(
    sanitizeAssistantVisibleText("list_dir projects/live-quality-fastapi", ["list_dir"]),
    ""
  );
});

test("sanitizeAssistantVisibleText strips model control tokens", () => {
  assert.equal(sanitizeAssistantVisibleText("<|channel>"), "");
  assert.equal(sanitizeAssistantVisibleText("<channel|>"), "");
  assert.equal(
    sanitizeAssistantVisibleText("Here is the summary.\n<|channel>"),
    "Here is the summary."
  );
  assert.equal(
    sanitizeAssistantVisibleText("Here is the summary.\n<channel|>"),
    "Here is the summary."
  );
});

test("stripReasoningPlaceholderLines removes standalone streamed thought tokens", () => {
  const spam = ["intro", ...Array(12).fill("thought"), "done"].join("\n");
  assert.equal(stripReasoningPlaceholderLines(spam), "intro\ndone");
});

test("sanitizeAssistantVisibleText strips reasoning placeholder lines", () => {
  assert.equal(
    sanitizeAssistantVisibleText("Summary follows.\nthought\nTHOUGHT\n\nEnd."),
    "Summary follows.\n\nEnd."
  );
});

test("createToolAwareStreamWriter flush surfaces tail when stream ends inside <<<TOOL>>> block", () => {
  const chunks = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("before ");
  w.push('<<<TOOL>>>{"name":"read_file"');
  w.flush();
  assert.equal(chunks.join(""), 'before {"name":"read_file"');
});

test("extractClarifyMarkers pulls host blocks and strips them from visible text", () => {
  const raw = `Here is context.

<<<CLARIFY>>>
{"question":"Which stack?","options":["React","Vue"],"open_ended":false}
<<<END>>>

Trailing.`;
  const { blocks, visible } = extractClarifyMarkers(raw);
  assert.equal(blocks.length, 1);
  assert.match(blocks[0], /<<<CLARIFY>>>/);
  assert.match(blocks[0], /Which stack/);
  assert.ok(visible.includes("Here is context"));
  assert.ok(visible.includes("Trailing"));
  assert.ok(!visible.includes("CLARIFY"));
  assert.equal(
    sanitizeAssistantVisibleText(raw, []),
    sanitizeAssistantVisibleText(visible, []),
  );
});

test("normalizeToolCalls rejects duplicate same-turn tool calls with identical args", () => {
  const raw = [
    { name: "read_file", arguments: { path: "src/a.ts" } },
    { name: "read_file", arguments: { path: "src/a.ts" } },
    { name: "list_dir", arguments: { path: "." } },
  ];
  const { normalized, rejected } = normalizeToolCalls(raw, ["read_file", "list_dir"]);
  assert.equal(normalized.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "duplicate_call");
});
