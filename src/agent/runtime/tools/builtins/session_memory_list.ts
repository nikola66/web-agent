import { defineTool } from "../definition.js";
import { sessionMemoryRecallTool } from "../remote-tools.js";

const SESSION_MEMORY_LIST_EXAMPLES = [{ limit: 30 }, {}];

export default defineTool({
  name: "session_memory_list",
  run: sessionMemoryRecallTool,
  emoji: "🗂️",
  description:
    "Read newest rolling session notes from `session_memory_append`. Optional `limit` (number). " +
    "Example: " +
    JSON.stringify(SESSION_MEMORY_LIST_EXAMPLES[0]),
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description: "Max lines to return (default 30, max 200).",
      },
    },
    additionalProperties: false,
    examples: SESSION_MEMORY_LIST_EXAMPLES,
  },
});
