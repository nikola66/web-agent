import { defineTool } from "../definition.js";
import { composioStatusTool } from "../composio-tools.js";

const EXAMPLES = [
  {},
  { app: "gmail", user_id: "default" },
];

export default defineTool({
  name: "composio_status",
  run: composioStatusTool,
  emoji: "🔌",
  description:
    "Check Composio configuration, connected accounts, missing app auth, and the curated marketing action allowlist. Use before external app work. Returns setup guidance when `WEBAGENT_COMPOSIO_API_KEY` is missing. Examples: " +
    JSON.stringify(EXAMPLES[0]) +
    " | " +
    JSON.stringify(EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      app: { type: "string", description: "Optional app filter such as gmail, google_sheets, hubspot, notion, slack, linkedin, twitter, youtube." },
      user_id: { type: "string", description: "Optional Composio user/entity id to check." },
    },
    required: [],
    additionalProperties: false,
    examples: EXAMPLES,
  },
});

