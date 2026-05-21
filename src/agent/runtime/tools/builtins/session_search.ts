import { defineTool } from "../definition.js";
import { sessionSearchTool } from "../remote-tools.js";

export default defineTool({
  name: "session_search",
  run: sessionSearchTool,
  emoji: "📇",
  description: "Search prior work across conversation archives (`memory/conversations/*.json`), run history (`memory/runs/*.json`), and rolling session notes (`.webagent/session-memory.jsonl`). Keyword `query` for targeted search; use `recent`, `latest`, or `last session` (or phrases like \"last work task\") for recency-only top matches. Returns top 3 excerpts with ±200-character context.",
  inputSchema: { type: "object", properties: { query: { type: "string", description: "Keywords, or recency tokens such as recent/latest/last session." }, max_files: { type: "number", description: "Max recent conversation files to scan (default 80, max 200)." } }, required: ["query"], additionalProperties: false },
});
