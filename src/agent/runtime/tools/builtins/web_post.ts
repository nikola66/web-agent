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
    json: { title: "Hello", status: "draft", author: 1 },
  },
  {
    url: "https://api.example.com/items/posts/42",
    method: "PATCH",
    headers: { Authorization: "Bearer <token>" },
    body: '{"status":"published"}',
  },
  {
    url: "https://api.example.com/items/posts/42",
    method: "DELETE",
    headers: { Authorization: "Bearer <token>" },
  },
  {
    url: "https://api.example.com/oauth/token",
    method: "POST",
    form: { grant_type: "client_credentials", client_id: "<id>", client_secret: "<secret>" },
  },
];

export default defineTool({
  name: "web_post",
  run: webPostTool,
  emoji: "📮",
  description:
    "Primary HTTP client for JSON/GraphQL REST writes (POST/PATCH/PUT/DELETE/HEAD/OPTIONS). Not for CMS file uploads — use `web_upload`; mixed form fields + file(s) → `multipart` array (runtime reads `file_path`/`source_url`). Never pass base64 in args. Procedure: skill_view **`http-api`**. Not for OAuth SaaS — use `composio_*`. Pair with `web_fetch` for GET. Examples: " +
    JSON.stringify(WEB_POST_EXAMPLES[0]) +
    " | " +
    JSON.stringify(WEB_POST_EXAMPLES[2]) +
    " | " +
    JSON.stringify(WEB_POST_EXAMPLES[3]),
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Target http(s) URL." },
      body: {
        type: "string",
        description:
          "Request body as string (JSON.stringify for objects). Required for POST/PATCH/PUT unless `json` or `form` is set.",
      },
      json: {
        type: "object",
        description: "JSON object body — auto-stringified (alias-friendly alternative to `body`).",
      },
      form: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "application/x-www-form-urlencoded fields (OAuth token exchange, HTML forms).",
      },
      params: {
        type: "object",
        additionalProperties: true,
        description: "Query params merged into url (Axios-style). Values stringified; arrays append repeated keys.",
      },
      method: {
        type: "string",
        enum: ["POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"],
        description: "HTTP method (default POST). PATCH/PUT update; DELETE/HEAD/OPTIONS omit body.",
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
      body_encoding: {
        type: "string",
        enum: ["base64"],
        description: "Last resort only: decode `body` from base64. Prefer `web_upload` (CMS /files) or `multipart` with file_path/source_url.",
      },
      multipart: {
        type: "array",
        description:
          "Multipart form fields. Each item: name + text, or name + file_path/source_url (+ optional filename, content_type). Runtime reads/fetches bytes — never pass base64.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            text: { type: "string" },
            filename: { type: "string" },
            content_type: { type: "string" },
            file_path: { type: "string" },
            source_url: { type: "string" },
          },
          required: ["name"],
        },
      },
      timeout_ms: {
        type: "number",
        description: "Request timeout in ms (default 120000; max 600000). Use for large CMS payloads.",
      },
    },
    required: ["url"],
    additionalProperties: true,
    examples: WEB_POST_EXAMPLES,
  },
});
