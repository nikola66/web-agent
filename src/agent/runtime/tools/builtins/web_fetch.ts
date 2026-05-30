import { defineTool } from "../definition.js";
import { webFetchTool } from "../remote-tools.js";

const WEB_FETCH_EXAMPLES = [
  { url: "https://example.com/docs", response_format: "markdown" },
  {
    url: "https://hub.aratech.ae/items/posts",
    response_format: "api",
    headers: { Authorization: "Bearer <token>" },
  },
];

export default defineTool({
  name: "web_fetch",
  run: webFetchTool,
  emoji: "🌐",
  description:
    "GET http(s) URL(s) — public pages or authenticated REST reads. `response_format`: `markdown` (default) uses TinyFish for readable page text; `api` uses direct proxy for JSON/REST/GraphQL (also auto-selected for `/items/`, `/graphql`, `/api/`, `api.*` hosts, or any `headers`). Binary download → `save_to` workspace path (metadata only; no inline bytes). Pass `headers` with Bearer for CMS/API auth (`skill` (action=view) **`http-api`**). Not for OAuth SaaS — use `composio_*`. Prefer over run_shell for HTTP GET. Batch up to 5 URLs via `urls`. Examples: " +
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
      save_to: {
        type: "string",
        description: "Save binary response to workspace path; returns bytes/path metadata only. Then pass path to web_upload.file_path — never read base64 into tool args.",
      },
      response_encoding: {
        type: "string",
        enum: ["base64"],
        description: "Last resort for tiny binaries only. Prefer save_to + web_upload.file_path for CMS uploads.",
      },
      response_format: {
        type: "string",
        enum: ["markdown", "api"],
        description:
          "markdown: TinyFish page reader for public HTML (default when URL looks like a normal page). api: direct proxy JSON/text — use for REST, GraphQL, CMS `/items/`, workflow calls; also inferred from URL shape and headers.",
      },
    },
    additionalProperties: true,
    examples: WEB_FETCH_EXAMPLES,
  },
});
