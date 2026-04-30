import { defineTool } from "../definition.js";
import { memorySearchTool } from "../remote-tools.js";

export default defineTool({
  name: "memory_search",
  run: memorySearchTool,
  emoji: "🔮",
  description: "Substring-search saved memory facts by `query`. Returns matching key/value rows. Use `memory_recall` when you already know the exact key.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
