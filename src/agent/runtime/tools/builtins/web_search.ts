import { defineTool } from "../definition.js";
import { webSearchTool } from "../remote-tools.js";

export default defineTool({
  name: "web_search",
  run: webSearchTool,
  emoji: "🔍",
  description:
    "Search the web and return ranked results. Query may include operators: site:example.com, \"exact phrase\", -term, OR. Use location (e.g. ae, sa) and language (e.g. en, ar) when relevant. Follow with web_fetch on promising URLs.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query (required)." },
      location: { type: "string", description: "Geo hint for the provider (e.g. ae, sa, us)." },
      language: { type: "string", description: "Language code (e.g. en, ar)." },
      page: { type: "number", description: "Result page 0–10 (default 0)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
});
