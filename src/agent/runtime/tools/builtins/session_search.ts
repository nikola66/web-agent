import { defineTool } from "../definition.js";
import { sessionSearchTool } from "../remote-tools.js";

export default defineTool({
  name: "session_search",
  run: sessionSearchTool,
  emoji: "📇",
  description: "Search prior work by keywords across conversation archives (`memory/conversations/*.json`), run history (`memory/runs/*.json`), and rolling session notes (`.webagent/session-memory.jsonl`). Returns top 3 excerpts with ±200-character context.",
  inputSchema: { type: "object", properties: { query: { type: "string", description: "Space-separated keywords to find in archived conversations." }, max_files: { type: "number", description: "Max recent conversation files to scan (default 80, max 200)." } }, required: ["query"], additionalProperties: false },
});
