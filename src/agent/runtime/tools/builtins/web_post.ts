import { defineTool } from "../definition.js";
import { webPostTool } from "../remote-tools.js";

const WEB_POST_EXAMPLES = [
  {
    url: "https://api.example.com/graphql",
    headers: { Authorization: "Bearer <token>", "Content-Type": "application/json" },
    body: '{"query":"query { __typename }"}',
  },
  {
    url: "https://api.example.com/items/posts",
    headers: { Authorization: "Bearer <token>" },
    body: '{"title":"Hello","status":"draft","author":1}',
  },
];

export default defineTool({
  name: "web_post",
  run: webPostTool,
  emoji: "📮",
  description:
    "POST http(s) with optional headers and body. Use for GraphQL, REST writes, and JSON APIs — prefer over run_shell + axios/fetch one-liners. Full REST/GraphQL procedure: skill_view **`http-api`**. Pair with `web_fetch` for GET reads. Pass Bearer/API keys in `headers`, not in the URL. `body` must be a JSON string — write it as '{\"key\":\"value\"}' or JSON.stringify({...}), never as an object literal with escaped-quote keys. Examples: " +
    JSON.stringify(WEB_POST_EXAMPLES[0]) +
    " | " +
    JSON.stringify(WEB_POST_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Target http(s) URL." },
      body: {
        type: "string",
        description: "Request body as a JSON string — always stringify: JSON.stringify({...}) or '{\"key\":\"val\"}'. Do NOT pass a raw object with escaped quote keys.",
      },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional HTTP headers (e.g. Authorization Bearer token).",
      },
      content_type: {
        type: "string",
        description: "Optional Content-Type override (defaults to application/json for JSON-looking bodies).",
      },
    },
    required: ["url", "body"],
    additionalProperties: true,
    examples: WEB_POST_EXAMPLES,
  },
});
