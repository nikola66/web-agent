import { defineTool } from "../definition.js";
import { memorySaveTool } from "../remote-tools.js";

const MEMORY_SAVE_EXAMPLES = [
  { key: "user_city", value: "Austin" },
  { key: "prefs", value: { theme: "dark", density: "compact" } },
];

export default defineTool({
  name: "memory_save",
  run: memorySaveTool,
  emoji: "💾",
  description:
    "Save a durable memory fact under a stable key. Required: `key` (short snake_case id) and `value`. " +
    "Use for user preferences, stable env facts, and conventions that will still matter later. " +
    "Do NOT save task progress, PR/issue numbers, or artifacts stale in ~7 days — use `session_search` " +
    "or `session_memory_append`. Repeatable workflows belong in skills, not memory. " +
    "Examples (arguments JSON only): " +
    JSON.stringify(MEMORY_SAVE_EXAMPLES[0]) +
    " | " +
    JSON.stringify(MEMORY_SAVE_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Stable snake_case identifier (e.g. user_timezone, preferred_editor).",
      },
      value: {
        description: "Fact body: string, number, boolean, object, or array.",
      },
    },
    required: ["key", "value"],
    additionalProperties: false,
    examples: MEMORY_SAVE_EXAMPLES,
  },
});
