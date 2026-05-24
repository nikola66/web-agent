import { defineTool } from "../definition.js";
import { webFetchTool } from "../remote-tools.js";

const WEB_FETCH_EXAMPLES = [
  { url: "https://example.com/docs" },
  {
    url: "https://api.example.com/v1/resources",
    headers: { Authorization: "Bearer <token>" },
  },
];

export default defineTool({
  name: "web_fetch",
  run: webFetchTool,
  emoji: "🌐",
  description:
    "GET http(s) URL(s) — public pages or authenticated REST reads. Pass optional `headers` (e.g. Authorization Bearer). Full REST/GraphQL procedure: skill_view **`http-api`**. Prefer over run_shell for one-off HTTP GET; use `web_post` for POST/GraphQL. Batch up to 5 URLs via `urls`. Examples: " +
    JSON.stringify(WEB_FETCH_EXAMPLES[0]) +
    " | " +
    JSON.stringify(WEB_FETCH_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Single http(s) URL." },
      urls: {
        type: "array",
        items: { type: "string" },
        description: "Up to 5 http(s) URLs to fetch in one call (same headers applied to each).",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional HTTP headers for authenticated GET (Bearer token, API keys).",
      },
      params: {
        type: "object",
        additionalProperties: true,
        description: "Query params merged into url (Axios-style).",
      },
    },
    additionalProperties: true,
    examples: WEB_FETCH_EXAMPLES,
  },
});
