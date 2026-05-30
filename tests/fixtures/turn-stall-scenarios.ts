/** Regression fixtures from BitNet / Directus turn-stall transcripts. */

export type TurnStallParseScenario = {
  id: string;
  description: string;
  combined: string;
  activeToolNames: string[];
  userInput?: string;
  expectToolNames: string[];
  minTools?: number;
};

export type TurnStallContinuationScenario = {
  id: string;
  description: string;
  combined: string;
  visible: string;
  userInput: string;
  executedToolsInTurn: boolean;
  runToolCalls: Array<{ name: string }>;
  lastToolExecutions?: Array<{ tool: string; result?: Record<string, unknown> }>;
  expectContinuationKind:
    | "unparsed_tool_markup"
    | "content_share"
    | "post_tool_stall"
    | "pre_tool_promise"
    | "incomplete_todos"
    | "incomplete_publish"
    | "none";
  todoStats?: { total: number; completed: number; open: number };
};

export const PLAIN_SPLIT_TREE_SCENARIO: TurnStallParseScenario = {
  id: "plain_split_tree",
  description: "OpenCode emits tree/. on separate lines plus read_file hint",
  combined: `Let me look into what was being worked on.

tree
.

article draft content read_file

tree
.`,
  activeToolNames: ["browse_workspace", "read_file", "skill", "session_search"],
  userInput: "continue working on article",
  expectToolNames: ["browse_workspace"],
  minTools: 2,
};

export const DSML_BROWSE_SCENARIO: TurnStallParseScenario = {
  id: "dsml_browse",
  description: "DeepSeek DSML browse_workspace find calls",
  combined: `Let me start by finding where everything lives.

<｜DSML｜tool_calls>
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
</｜DSML｜tool_calls>`,
  activeToolNames: ["browse_workspace", "read_file", "skill"],
  userInput: "share the article to see for review",
  expectToolNames: ["browse_workspace"],
  minTools: 2,
};

export const TURN_STALL_PARSE_SCENARIOS: TurnStallParseScenario[] = [
  PLAIN_SPLIT_TREE_SCENARIO,
  DSML_BROWSE_SCENARIO,
];

const ARTICLE_BODY = `# BitNet B1.58\n\n${"Quantized inference enables edge deployment. ".repeat(20)}`;

export const CONTENT_SHARE_AFTER_READ_SCENARIO: TurnStallContinuationScenario = {
  id: "content_share_after_read",
  description: "User asked to share draft; model promises instead of pasting read_file body",
  combined: "",
  visible:
    "Let me grab the full article content so we can see what's there and what's missing.",
  userInput: "share the article to see for review",
  executedToolsInTurn: true,
  runToolCalls: [{ name: "read_file" }],
  lastToolExecutions: [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: ARTICLE_BODY,
      },
    },
  ],
  expectContinuationKind: "content_share",
};

/** User report: show article in markdown after read_file; partial preamble only. */
export const MARKDOWN_SHOW_AFTER_READ_SCENARIO: TurnStallContinuationScenario = {
  id: "markdown_show_after_read",
  description: "Show article in markdown; read_file ok but assistant only promises to paste",
  combined: "",
  visible: "Let me grab the full content properly — the read_file only showed",
  userInput: "can you show me the article in markdown?",
  executedToolsInTurn: true,
  runToolCalls: [{ name: "read_file" }],
  lastToolExecutions: [
    {
      tool: "read_file",
      result: {
        ok: true,
        path: "work/bitnet-article/bitnet-b1-58-2b4t.md",
        content: ARTICLE_BODY,
      },
    },
  ],
  expectContinuationKind: "content_share",
};

export const UNPARSED_DSML_FALLBACK_SCENARIO: TurnStallContinuationScenario = {
  id: "unparsed_dsml_fallback",
  description: "DSML read_file hint with read_file inactive still triggers unparsed_tool_markup",
  combined: `Let me read the article now.

<｜DSML｜tool_calls><｜DSML｜invoke name="read_file"></｜DSML｜invoke></｜DSML｜tool_calls>`,
  visible: "Let me read the article now.",
  userInput: "continue working on article",
  executedToolsInTurn: false,
  runToolCalls: [],
  expectContinuationKind: "unparsed_tool_markup",
};

export const INCOMPLETE_TODOS_FAUX_COMPLETE_SCENARIO: TurnStallContinuationScenario = {
  id: "incomplete_todos_faux_complete",
  description: "Open todos remain but assistant claims task complete",
  combined: "",
  visible: "Auth refactor done. Task complete.",
  userInput: "Refactor auth, update docs, migrate DB, and notify customers.",
  executedToolsInTurn: true,
  runToolCalls: [{ name: "todo_write" }],
  todoStats: { total: 4, completed: 1, open: 3 },
  expectContinuationKind: "incomplete_todos",
};

export const INCOMPLETE_PUBLISH_DRAFT_READY_SCENARIO: TurnStallContinuationScenario = {
  id: "incomplete_publish_draft_ready",
  description: "Publish requested; draft written but assistant stops at ready-for-review",
  combined: "",
  visible: "The draft is ready for your review. All set.",
  userInput: "Search and create an article about BitNet and publish it on our blog",
  executedToolsInTurn: true,
  runToolCalls: [{ name: "web_search" }, { name: "write_file" }],
  expectContinuationKind: "incomplete_publish",
};

export const POST_TOOL_PUBLISH_PROMISE_SCENARIO: TurnStallContinuationScenario = {
  id: "post_tool_publish_promise",
  description: "After write_file, assistant promises publish instead of calling web_post",
  combined: "",
  visible:
    "Draft saved to work/bitnet-article/bitnet-b1-58-2b4t.md. I'll publish it to the blog next.",
  userInput: "Search and create an article about BitNet and publish it on our blog",
  executedToolsInTurn: true,
  runToolCalls: [{ name: "web_search" }, { name: "write_file" }],
  expectContinuationKind: "post_tool_stall",
};

/** Active tools for continuation scenarios where read_file must stay hidden/inactive. */
export const CONTINUATION_ACTIVE_TOOL_NAMES = ["browse_workspace", "skill", "session_search"];

export const TURN_STALL_CONTINUATION_SCENARIOS: TurnStallContinuationScenario[] = [
  CONTENT_SHARE_AFTER_READ_SCENARIO,
  MARKDOWN_SHOW_AFTER_READ_SCENARIO,
  UNPARSED_DSML_FALLBACK_SCENARIO,
  INCOMPLETE_TODOS_FAUX_COMPLETE_SCENARIO,
  INCOMPLETE_PUBLISH_DRAFT_READY_SCENARIO,
  POST_TOOL_PUBLISH_PROMISE_SCENARIO,
];

/** Playwright mock: first LLM hop from the latest user report. */
export const MOCK_PLAIN_TOOL_HINTS_RESPONSE = PLAIN_SPLIT_TREE_SCENARIO.combined;

export const MOCK_FOLLOWUP_RESPONSE = "STALL_TEST_OK — workspace explored.";
