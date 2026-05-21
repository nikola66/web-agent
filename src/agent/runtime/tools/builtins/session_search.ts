import { defineTool } from "../definition.js";
import { sessionSearchTool } from "../remote-tools.js";

const SESSION_SEARCH_EXAMPLES = [
  { query: "Ainex sales outreach plan assets" },
  { query: "recent", max_files: 40 },
];

export default defineTool({
  name: "session_search",
  run: sessionSearchTool,
  emoji: "📇",
  description:
    "Search prior sessions (conversation archives, run history, session notes). " +
    "Required: `query` (plain string keywords, or recency tokens: recent, latest, last session). " +
    "Pass JSON like " +
    JSON.stringify(SESSION_SEARCH_EXAMPLES[0]) +
    " — property names must be unquoted keys (`query`, not `\"query\"`). " +
    "Optional `max_files` (number).",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords or recency tokens (recent, latest, last session).",
      },
      max_files: {
        type: "number",
        description: "Max conversation files to scan (default 80, max 200).",
      },
    },
    required: ["query"],
    additionalProperties: false,
    examples: SESSION_SEARCH_EXAMPLES,
  },
});
