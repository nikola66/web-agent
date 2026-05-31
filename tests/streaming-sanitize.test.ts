import test from "node:test";
import assert from "node:assert/strict";

import {
  DSML_TOOLCALLS_END_MARKER,
  DSML_TOOLCALLS_START_MARKER,
} from "../dist/agent-runtime/constants.js";
import {
  createToolAwareStreamWriter,
  estimateMessageTokens,
  extractClarifyMarkers,
  extractLooseCallToolLines,
  extractPlainToolCommandLines,
  extractJsonToolCallPayloads,
  extractLongcatToolCallPayloads,
  extractNamedXmlToolCallPayloads,
  extractDsmlToolCallPayloads,
  extractFunctionXmlToolCallPayloads,
  extractMarkerTools,
  looksLikeUnparsedPlainToolHints,
  looksLikeUnparsedToolMarkup,
  normalizeToolCalls,
  resolveKnownToolName,
  sanitizeAssistantVisibleText,
  stripMarkupForContinuationHeuristics,
  stripPseudoToolCallLines,
  stripReasoningPlaceholderLines,
} from "../dist/agent-runtime/llm/streaming.js";

test("estimateMessageTokens counts array content and tool_calls, not [object Object]", () => {
  const longText = "x".repeat(4000);
  const stringMsg = { role: "user", content: longText };
  const arrayMsg = {
    role: "user",
    content: [{ type: "text", text: longText }, { type: "image_url", image_url: { url: longText } }],
  };
  // Array content must count its parts, not collapse to "[object Object]" (~4 tokens).
  assert.ok(estimateMessageTokens(arrayMsg) > estimateMessageTokens(stringMsg));
  assert.ok(estimateMessageTokens(arrayMsg) > 1000);

  // Assistant tool_calls payloads are real tokens even when content is null.
  const toolCallMsg = {
    role: "assistant",
    content: null,
    tool_calls: [{ function: { name: "web_fetch", arguments: JSON.stringify({ url: longText }) } }],
  };
  assert.ok(estimateMessageTokens(toolCallMsg) > 900);

  // Empty/short messages stay cheap.
  assert.ok(estimateMessageTokens({ role: "user", content: "" }) < 10);
});

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

test("extractPlainToolCommandLines merges split tree and path lines", () => {
  const raw = `Let me look into what was being worked on.

tree
.

Done.`;
  const parsed = extractPlainToolCommandLines(raw, ["browse_workspace"]);
  assert.deepEqual(parsed.tools, [{ name: "browse_workspace", arguments: { action: "tree", path: "." } }]);
  assert.match(parsed.visible, /look into what was being worked on/i);
  assert.doesNotMatch(parsed.visible, /^\s*tree\s*$/m);
});

test("extractPlainToolCommandLines maps tree to browse_workspace when tree is hidden", () => {
  const parsed = extractPlainToolCommandLines("tree .", ["browse_workspace", "read_file"]);
  assert.deepEqual(parsed.tools, [
    { name: "browse_workspace", arguments: { action: "tree", path: "." } },
  ]);
});

test("extractPlainToolCommandLines parses trailing read_file hint as browse find", () => {
  const parsed = extractPlainToolCommandLines("article draft content read_file", ["browse_workspace"]);
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, "browse_workspace");
  assert.equal(parsed.tools[0].arguments.action, "find");
  assert.match(String(parsed.tools[0].arguments.pattern), /article/i);
});

test("looksLikeUnparsedPlainToolHints detects transcript-style tool lines", () => {
  const raw = `Let me look into what was being worked on.

tree
.

article draft content read_file

tree
.`;
  assert.equal(looksLikeUnparsedPlainToolHints(raw), true);
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

test("createToolAwareStreamWriter flush drops tail when stream ends inside <<<TOOL>>> block", () => {
  const chunks = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("before ");
  w.push('<<<TOOL>>>{"name":"read_file"');
  w.flush();
  assert.equal(chunks.join(""), "before ");
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

test("resolveKnownToolName maps find_find_files to find_files", () => {
  assert.equal(resolveKnownToolName("find_find_files", ["find_files", "list_dir"]), "find_files");
});

test("resolveKnownToolName maps cross-host Claude/Codex tool names", () => {
  const tools = ["read_file", "web_fetch", "web_search", "run_shell", "find_files", "skill"];
  assert.equal(resolveKnownToolName("Read", tools), "read_file");
  assert.equal(resolveKnownToolName("WebFetch", tools), "web_fetch");
  assert.equal(resolveKnownToolName("Bash", tools), "run_shell");
  assert.equal(resolveKnownToolName("Glob", tools), "find_files");
  assert.equal(resolveKnownToolName("skill_view", tools), "skill");
  assert.equal(resolveKnownToolName("functions.web_fetch", tools), "web_fetch");
});

test("normalizeToolCalls remaps cross-host names and argument aliases", () => {
  const { normalized, rejected } = normalizeToolCalls(
    [
      { name: "Read", arguments: { target_file: "README.md" } },
      { name: "WebFetch", arguments: { link: "https://example.com" } },
    ],
    ["read_file", "web_fetch"],
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].name, "read_file");
  assert.equal(normalized[0].arguments.path, "README.md");
  assert.equal(normalized[1].name, "web_fetch");
  assert.equal(normalized[1].arguments.url, "https://example.com");
});

test("extractLooseCallToolLines parses call:tool wire with name= typos", () => {
  const raw = `Queued prose.

call:tool{"name="find_find_files"arguments={"patterns":["outreach","sequence"],"matchMode":"any"}}

Done.`;
  const parsed = extractLooseCallToolLines(raw, ["find_files"]);
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, "find_files");
  assert.deepEqual(parsed.tools[0].arguments.patterns, ["outreach", "sequence"]);
  assert.ok(!parsed.visible.includes("call:tool"));
  assert.ok(parsed.visible.includes("Done."));
});

test("normalizeToolCalls accepts duplicated find_find_files name", () => {
  const { normalized, rejected } = normalizeToolCalls(
    [{ name: "find_find_files", arguments: { patterns: ["outreach"] } }],
    ["find_files"]
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized[0].name, "find_files");
});

test("resolveKnownToolName maps skill_save to skill in review toolsets", () => {
  const reviewTools = ["skill", "read_file"];
  assert.equal(resolveKnownToolName("skill_save", reviewTools), "skill");
  assert.equal(resolveKnownToolName("skill_create", reviewTools), "skill");
});

test("normalizeToolCalls maps skill_save to skill manage create", () => {
  const { normalized, rejected } = normalizeToolCalls(
    [
      {
        name: "skill_save",
        arguments: { name: "json-editing", content: "---\nname: JSON\n---\n\nUse 2 spaces." },
      },
    ],
    ["skill", "read_file"]
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized[0].name, "skill");
  assert.equal(normalized[0].arguments.action, "manage");
  assert.equal(normalized[0].arguments.manage_action, "create");
});

test("resolveKnownToolName maps bulk import aliases to skill", () => {
  const tools = ["skill", "read_file"];
  assert.equal(resolveKnownToolName("bulk_import", tools), "skill");
  assert.equal(resolveKnownToolName("skill_bulk_import", tools), "skill");
  assert.equal(resolveKnownToolName("BulkImport", tools), "skill");
});

test("normalizeToolCalls maps bulk_import to skill bulk", () => {
  const { normalized, rejected } = normalizeToolCalls(
    [
      {
        name: "bulk_import",
        arguments: { urls: ["https://example.com/a/SKILL.md", "https://example.com/b/SKILL.md"] },
      },
    ],
    ["skill", "read_file"]
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized[0].name, "skill");
  assert.equal(normalized[0].arguments.action, "bulk");
  assert.equal(normalized[0].arguments.items?.length, 2);
});

test("sanitizeAssistantVisibleText strips call:tool loose lines", () => {
  const raw = `Intro
call:tool{"name="find_find_files"arguments={"patterns":["x"]}}
Outro`;
  const out = sanitizeAssistantVisibleText(raw, ["find_files"]);
  assert.ok(out.includes("Intro"));
  assert.ok(out.includes("Outro"));
  assert.ok(!out.includes("call:tool"));
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

test("normalizeToolCalls merges flat path/content beside name for write_file", () => {
  const article = "# BitNet\n\n".repeat(20);
  const { normalized, rejected } = normalizeToolCalls(
    [{ name: "write_file", path: "projects/blog/bitnet.md", content: article }],
    ["write_file"]
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized[0].name, "write_file");
  assert.equal(normalized[0].arguments.path, "projects/blog/bitnet.md");
  assert.ok(String(normalized[0].arguments.content).includes("# BitNet"));
});

test("extractMarkerTools salvages broken write_file marker JSON", () => {
  const body = "## Section\n\n".repeat(30);
  const payload = `{"path":"projects/demo/article.md","content":${JSON.stringify(body)}}`;
  const broken = payload.slice(0, -3);
  const raw = `Intro\n<<<TOOL>>>${broken}<<<END>>>\nOutro`;
  const parsed = extractMarkerTools(raw);
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, "write_file");
  const args = parsed.tools[0].arguments as Record<string, unknown>;
  assert.equal(args.path, "projects/demo/article.md");
  assert.ok(String(args.content).includes("## Section"));
});

test("normalizeToolCalls merges flat path/code beside name for run_python", () => {
  const { normalized, rejected } = normalizeToolCalls(
    [{ name: "run_python", path: "work/publish.py", code: "print('ok')" }],
    ["run_python"]
  );
  assert.equal(rejected.length, 0);
  assert.equal(normalized[0].name, "run_python");
  assert.equal(normalized[0].arguments.path, "work/publish.py");
  assert.equal(normalized[0].arguments.code, "print('ok')");
});

test("extractLongcatToolCallPayloads parses plain tool names and arg key/value pairs", () => {
  const raw = `Intro<longcat_tool_call>composio_status
</longcat_tool_call>
<longcat_tool_call>skill_view
<longcat_arg_key>name</longcat_arg_key>
<longcat_arg_value>composio-oauth</longcat_arg_value>
</longcat_tool_call>
Outro.`;
  const parsed = extractLongcatToolCallPayloads(raw);
  assert.deepEqual(parsed.tools, [
    { name: "composio_status", arguments: {} },
    { name: "skill_view", arguments: { name: "composio-oauth" } },
  ]);
  assert.equal(parsed.visible, "Intro\n\nOutro.");
});

test("extractLongcatToolCallPayloads parses JSON payloads", () => {
  const raw = `<longcat_tool_call>
{"name":"read_file","arguments":{"path":"README.md"}}
</longcat_tool_call>`;
  const parsed = extractLongcatToolCallPayloads(raw);
  assert.deepEqual(parsed.tools, [
    { name: "read_file", arguments: { path: "README.md" } },
  ]);
  assert.equal(parsed.visible, "");
});

test("sanitizeAssistantVisibleText strips longcat tool call markup", () => {
  const raw = `Checking status.<longcat_tool_call>composio_status
</longcat_tool_call>`;
  assert.equal(sanitizeAssistantVisibleText(raw), "Checking status.");
});

test("createToolAwareStreamWriter hides complete longcat blocks during stream", () => {
  const chunks = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Checking status.");
  w.push("<longcat_tool_call>composio_status</longcat_tool_call>");
  w.push(" Done.");
  w.flush();
  assert.equal(chunks.join(""), "Checking status. Done.");
});

test("createToolAwareStreamWriter hides longcat blocks split across chunks", () => {
  const chunks = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Intro ");
  w.push("<longcat_tool_call>read_file");
  w.push("\n<longcat_arg_key>path</longcat_arg_key>");
  w.push("\n<longcat_arg_value>README.md</longcat_arg_value>");
  w.push("\n</longcat_tool_call>");
  w.push(" Outro.");
  w.flush();
  assert.equal(chunks.join(""), "Intro  Outro.");
});

test("extractLongcatToolCallPayloads ignores empty payloads but still strips markup", () => {
  const raw = `Before<longcat_tool_call></longcat_tool_call>After`;
  const parsed = extractLongcatToolCallPayloads(raw);
  assert.deepEqual(parsed.tools, []);
  assert.equal(parsed.visible, "BeforeAfter");
});

test("extractLongcatToolCallPayloads handles inline tags without newlines", () => {
  const raw = `Go.<longcat_tool_call>list_dir</longcat_tool_call>Done.`;
  const parsed = extractLongcatToolCallPayloads(raw);
  assert.deepEqual(parsed.tools, [{ name: "list_dir", arguments: {} }]);
  assert.equal(parsed.visible, "Go.Done.");
});

const DSML_TRANSCRIPT = `<｜DSML｜tool_calls>
<｜DSML｜invoke name="browse_workspace">
<｜DSML｜parameter name="action" string="true">find</｜DSML｜parameter>
<｜DSML｜parameter name="path" string="true">.</｜DSML｜parameter>
<｜DSML｜parameter name="pattern" string="true">publish*</｜DSML｜parameter>
</｜DSML｜invoke>
<｜DSML｜invoke name="browse_workspace">
<｜DSML｜parameter name="action" string="true">find</｜DSML｜parameter>
<｜DSML｜parameter name="path" string="true">.</｜DSML｜parameter>
<｜DSML｜parameter name="pattern" string="true">bitnet*</｜DSML｜parameter>
</｜DSML｜invoke>
</｜DSML｜tool_calls>`;

test("extractDsmlToolCallPayloads parses transcript browse_workspace calls", () => {
  const raw = `Let me start by finding where everything lives.\n\n${DSML_TRANSCRIPT}`;
  const parsed = extractDsmlToolCallPayloads(raw);
  assert.equal(parsed.tools.length, 2);
  assert.equal(parsed.tools[0].name, "browse_workspace");
  assert.equal(parsed.tools[0].arguments.action, "find");
  assert.equal(parsed.tools[0].arguments.pattern, "publish*");
  assert.equal(parsed.tools[1].arguments.pattern, "bitnet*");
  assert.equal(parsed.visible, "Let me start by finding where everything lives.");
  assert.doesNotMatch(parsed.visible, /DSML/);
});

test("sanitizeAssistantVisibleText strips DSML tool markup", () => {
  const raw = `Intro.\n${DSML_TRANSCRIPT}\nOutro.`;
  assert.equal(sanitizeAssistantVisibleText(raw), "Intro.\n\nOutro.");
});

test("looksLikeUnparsedToolMarkup detects DSML in raw combined text", () => {
  assert.equal(looksLikeUnparsedToolMarkup(DSML_TRANSCRIPT), true);
  assert.equal(looksLikeUnparsedToolMarkup("Let me read the article."), false);
});

test("stripMarkupForContinuationHeuristics removes DSML before tail heuristics", () => {
  const raw = `Let me start by finding where everything lives.\n\n${DSML_TRANSCRIPT}`;
  const cleaned = stripMarkupForContinuationHeuristics(raw);
  assert.doesNotMatch(cleaned, /DSML/);
  assert.match(cleaned, /finding where everything lives/i);
});

test("createToolAwareStreamWriter hides DSML tool_calls blocks during stream", () => {
  const chunks: string[] = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Intro ");
  w.push(DSML_TOOLCALLS_START_MARKER);
  w.push("<｜DSML｜invoke name=\"read_file\">");
  w.push("</｜DSML｜invoke>");
  w.push(DSML_TOOLCALLS_END_MARKER);
  w.push(" Outro.");
  w.flush();
  assert.equal(chunks.join(""), "Intro  Outro.");
});

test("extractFunctionXmlToolCallPayloads parses Hermes-style function blocks", () => {
  const raw = `Intro.

<function>
<function_name>read_file</function_name>
<function_arguments>{"path": "memory/runs/run.json"}</function_arguments>
</function>

<function>
<function_name>grep</function_name>
<function_parameters>{"pattern": "todo", "root": "."}</function_parameters>
</function>

Outro.`;
  const parsed = extractFunctionXmlToolCallPayloads(raw);
  assert.equal(parsed.tools.length, 2);
  assert.equal(parsed.tools[0]?.name, "read_file");
  assert.deepEqual(parsed.tools[0]?.arguments, { path: "memory/runs/run.json" });
  assert.equal(parsed.tools[1]?.name, "grep");
  assert.deepEqual(parsed.tools[1]?.arguments, { pattern: "todo", root: "." });
  assert.match(parsed.visible, /Intro\./);
  assert.match(parsed.visible, /Outro\./);
  assert.doesNotMatch(parsed.visible, /<function>/i);
  assert.equal(sanitizeAssistantVisibleText(raw), parsed.visible);
});

test("extractNamedXmlToolCallPayloads parses Big Pickle bare XML tool tags", () => {
  const raw = `Let me see what we've got so far.

<read_file>
<path>projects/ciso-challenges-2026/article.md</path>
</read_file>

<read_file>
<path>projects/ciso-challenges-2026/article.md</path>
</read_file>`;
  const parsed = extractNamedXmlToolCallPayloads(raw, ["read_file", "artifact_present"]);
  assert.deepEqual(parsed.tools, [
    { name: "read_file", arguments: { path: "projects/ciso-challenges-2026/article.md" } },
    { name: "read_file", arguments: { path: "projects/ciso-challenges-2026/article.md" } },
  ]);
  assert.match(parsed.visible, /Let me see/);
  assert.doesNotMatch(parsed.visible, /<read_file>/i);

  const normalized = normalizeToolCalls(parsed.tools, ["read_file"]);
  assert.equal(normalized.normalized.length, 1);
  assert.equal(normalized.rejected[0]?.reason, "duplicate_call");
});

test("sanitizeAssistantVisibleText strips Big Pickle bare XML tool tags", () => {
  const raw = `Intro.

<read_file>
<path>projects/ciso-challenges-2026/article.md</path>
</read_file>

Outro.`;
  const sanitized = sanitizeAssistantVisibleText(raw, ["read_file"]);
  assert.match(sanitized, /Intro\./);
  assert.match(sanitized, /Outro\./);
  assert.doesNotMatch(sanitized, /<read_file>/i);
  assert.doesNotMatch(sanitized, /<path>/i);
});

test("createToolAwareStreamWriter hides bare XML read_file blocks during stream", () => {
  const chunks: string[] = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Intro ");
  w.push("<read_file><path>x.md</path>");
  w.push("</read_file>");
  w.push(" Outro.");
  w.flush();
  assert.equal(chunks.join(""), "Intro  Outro.");
});

test("createToolAwareStreamWriter hides function XML blocks during stream", () => {
  const chunks: string[] = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Intro ");
  w.push('<function><function_name>read_file</function_name>');
  w.push('<function_arguments>{"path":"x.md"}</function_arguments></function>');
  w.push(" Outro.");
  w.flush();
  assert.equal(chunks.join(""), "Intro  Outro.");
});

test("createToolAwareStreamWriter drops incomplete function blocks on flush", () => {
  const chunks: string[] = [];
  const w = createToolAwareStreamWriter((c) => chunks.push(c));
  w.push("Intro ");
  w.push("<function><function_name>grep</function_name>");
  w.flush();
  assert.equal(chunks.join(""), "Intro ");
});

test("stripOrphanToolMarkerArtifacts removes truncated <<<TOOL>>> fragments", () => {
  const raw = 'Intro.\n<<<TOOL>>>{"name":"todo_write"';
  assert.equal(sanitizeAssistantVisibleText(raw), "Intro.");
});

test("extractMarkerTools salvages orphan <<<TOOL>>> marker without END", () => {
  const raw = 'Plan.\n<<<TOOL>>>{"name":"todo_write","arguments":{"path":"","count":0}}';
  const parsed = extractMarkerTools(raw);
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0]?.name, "todo_write");
  assert.doesNotMatch(parsed.visible, /<<<TOOL>>>/);
});
