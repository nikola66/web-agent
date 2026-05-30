import { defineTool } from "../definition.js";
import { composioActionTool } from "../composio-tools.js";

const EXAMPLES = [
  { action: "gmail_create_draft", args: { to: "lead@example.com", subject: "Intro", body: "Short draft." } },
  { action: "sheets_append_row", args: { spreadsheet_id: "sheet_id", range: "Leads!A:D", values: [["Name", "Email"]] } },
];

export default defineTool({
  name: "composio_action",
  run: composioActionTool,
  emoji: "🧩",
  toolGroup: "composio",
  description:
    "Execute one curated Composio OAuth action after `composio_status` confirms a connected account. Reads run normally; send/post/delete/publish may require approval. " +
    "Never tell the user an app is unavailable without calling `composio_status` first. Call `skill` (action=view) **`composio-oauth`** for action ids (e.g. LinkedIn → `linkedin_get_my_info`); `composio_status.allowed_actions` is authoritative. " +
    "Example: " +
    JSON.stringify(EXAMPLES[0]),
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "Curated Web Agent marketing action id." },
      args: { type: "object", description: "Action input passed to Composio." },
      connected_account_id: { type: "string", description: "Optional specific Composio connected account id." },
      user_id: { type: "string", description: "Optional Composio user/entity id." },
    },
    required: ["action", "args"],
    additionalProperties: false,
    examples: EXAMPLES,
  },
  requiresConfirmation: false,
  approvalSummary: "composio_action: action={{action}}",
});
