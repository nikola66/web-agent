import { defineTool } from "../definition.js";
import { webSearchTool } from "../remote-tools.js";

export default defineTool({
  name: "web_search",
  run: webSearchTool,
  emoji: "🔍",
  description: "Search the web and return ranked results.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
