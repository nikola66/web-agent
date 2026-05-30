import { defineTool } from "../definition.js";
import { webUploadTool } from "../remote-tools.js";

const WEB_UPLOAD_EXAMPLES = [
  {
    upload_url: "https://cms.example.com/files",
    headers: { Authorization: "Bearer <token>" },
    field_name: "file",
    filename: "hero.jpg",
    content_type: "image/jpeg",
    source_url: "https://images.example.com/hero.jpg",
  },
  {
    upload_url: "https://cms.example.com/files",
    headers: { Authorization: "Bearer <token>" },
    file_path: "projects/images/hero.jpg",
    field_name: "file",
    filename: "hero.jpg",
  },
];

export default defineTool({
  name: "web_upload",
  run: webUploadTool,
  emoji: "📤",
  description:
    "Upload one file via multipart/form-data — runtime reads `source_url` or workspace `file_path` and POSTs to `upload_url`. Primary path for CMS /files (Directus, etc.). Not for JSON/GraphQL REST writes — use `web_post`. Mixed form fields + file(s) → `web_post.multipart`. Model sees metadata (bytes, path) only — never pass base64 in args. Procedure: `skill` (action=view) **`http-api`**. Examples: " +
    JSON.stringify(WEB_UPLOAD_EXAMPLES[0]) +
    " | " +
    JSON.stringify(WEB_UPLOAD_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      upload_url: { type: "string", description: "Target http(s) upload URL (e.g. CMS /files)." },
      source_url: { type: "string", description: "Public http(s) URL to download bytes from (runtime-side)." },
      file_path: {
        type: "string",
        description: "Workspace-relative path to read bytes from (runtime-side).",
      },
      field_name: {
        type: "string",
        description: "Multipart field name for the file part (default file).",
      },
      filename: { type: "string", description: "Filename sent in Content-Disposition." },
      content_type: { type: "string", description: "MIME type for the file part (default application/octet-stream)." },
      headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "HTTP headers on the upload POST (Authorization, etc.).",
      },
      source_headers: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Optional headers when fetching source_url.",
      },
      timeout_ms: {
        type: "number",
        description: "Upload timeout in ms (default 120000; max 600000).",
      },
    },
    required: ["upload_url"],
    additionalProperties: false,
    examples: WEB_UPLOAD_EXAMPLES,
  },
});
