import { defineTool } from "../definition.js";
import { composioConnectTool } from "../composio-tools.js";

const EXAMPLES = [
  { app: "gmail", auth_config_id: "ac_123", user_id: "default" },
  { app: "hubspot", auth_config_id: "ac_456", callback_url: "https://example.com/composio/callback" },
];

export default defineTool({
  name: "composio_connect",
  run: composioConnectTool,
  emoji: "🔐",
  toolGroup: "composio",
  description:
    "Create a Composio hosted auth link for one app. Requires `WEBAGENT_COMPOSIO_API_KEY` and an `auth_config_id` (or env `WEBAGENT_COMPOSIO_AUTH_CONFIG_<APP>`). Return the `redirect_url` for the user to approve OAuth/API auth. Examples: " +
    JSON.stringify(EXAMPLES[0]) +
    " | " +
    JSON.stringify(EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      app: { type: "string", description: "App slug, e.g. gmail, google_sheets, hubspot, notion, slack, linkedin, twitter, youtube." },
      auth_config_id: { type: "string", description: "Composio Auth Config ID. Optional if app-specific env is configured." },
      user_id: { type: "string", description: "Stable Composio user/entity id. Defaults to profile user/default." },
      callback_url: { type: "string", description: "Optional URL Composio redirects to after auth." },
    },
    required: ["app"],
    additionalProperties: false,
    examples: EXAMPLES,
  },
});

