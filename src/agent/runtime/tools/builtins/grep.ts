import { defineTool } from "../definition.js";
import { grepTool } from "../filesystem-tools.js";

export default defineTool({
  name: "grep",
  run: grepTool,
  emoji: "🔍",
  description: "Search file contents for text or regex with bounded scan defaults. Skips heavy directories (e.g. node_modules, dist).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
