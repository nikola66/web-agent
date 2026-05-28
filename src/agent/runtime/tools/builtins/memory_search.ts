import { defineTool } from "../definition.js";
import { memorySearchTool } from "../remote-tools.js";

export default defineTool({
  name: "memory_search",
  run: memorySearchTool,
  emoji: "🔮",
  description:
    "Substring-search saved memory facts by `query`. Returns matching key/value rows. " +
    "Use when you need durable facts from prior sessions. Use `session_search` for past chat transcripts; " +
    "use `memory_recall` when you already know the exact key.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Topic or substring to match across saved facts." },
      limit: { type: "number", description: "Max results (default 30, max 1000)." },
    },
    required: ["query"],
    additionalProperties: true,
  },
});
