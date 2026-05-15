import { defineTool } from "../definition.js";
import { webFetchTool } from "../remote-tools.js";

export default defineTool({
  name: "web_fetch",
  run: webFetchTool,
  emoji: "🌐",
  description:
    "Fetch readable content from URL(s). Pass a single url or urls (array, max 5) for batch extraction of search hits.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Single http(s) URL." },
      urls: {
        type: "array",
        items: { type: "string" },
        description: "Up to 5 http(s) URLs to fetch in one call.",
      },
    },
    additionalProperties: true,
  },
});
