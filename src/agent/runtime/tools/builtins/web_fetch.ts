import { defineTool } from "../definition.js";
import { webFetchTool } from "../remote-tools.js";

export default defineTool({
  name: "web_fetch",
  run: webFetchTool,
  emoji: "🌐",
  description: "Fetch and summarize content from a URL.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
