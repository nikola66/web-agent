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
  toolGroup: "composio",
  description:
    "Check Composio setup and connected OAuth apps before any Gmail/LinkedIn/Slack/etc. work. Decision: (1) call this first when the user asks about their account or a connected SaaS — never claim 'no access' without checking; (2) if `connected_accounts` includes the app → use `composio_action`; (3) if app missing → `composio_connect`; (4) if `configured: false` → tell user to add `composio_api_key` in Settings (response includes `setup` steps — do not fetch repo docs). Returns `allowed_actions`. Examples: " +
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

