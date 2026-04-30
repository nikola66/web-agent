import { defineTool } from "../definition.js";
import { sessionSearchTool } from "../remote-tools.js";

export default defineTool({
  name: "session_search",
  run: sessionSearchTool,
  emoji: "📇",
  description: "Search past workspace conversation archives (`memory/conversations/*.json`) by keywords. Supply `query` (words to match); returns top 3 excerpts with ±200-character context.",
  inputSchema: { type: "object", properties: { query: { type: "string", description: "Space-separated keywords to find in archived conversations." }, max_files: { type: "number", description: "Max recent conversation files to scan (default 80, max 200)." } }, required: ["query"], additionalProperties: false },
});
