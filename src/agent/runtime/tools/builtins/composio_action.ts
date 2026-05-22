import { defineTool } from "../definition.js";
import { composioActionTool } from "../composio-tools.js";

const EXAMPLES = [
  { action: "gmail_create_draft", args: { to: "lead@example.com", subject: "Intro", body: "Short draft." } },
  { action: "sheets_append_row", args: { spreadsheet_id: "sheet_id", range: "Leads!A:D", values: [["Name", "Email"]] } },
  { action: "hubspot_create_contact", args: { email: "lead@example.com", firstname: "Ava" } },
];

export default defineTool({
  name: "composio_action",
  run: composioActionTool,
  emoji: "🧩",
  description:
    "Execute one curated Composio action. Use stable Web Agent actions, not arbitrary Composio catalog slugs. Reads run normally; outbound or destructive actions such as send/post/delete still ask for approval. Supported actions include Google Calendar read/write (`google_calendar_list_events`, `google_calendar_get_event`, `google_calendar_create_event`, `google_calendar_patch_event`, `google_calendar_delete_event`, `google_calendar_find_free_slots`), Gmail (`gmail_fetch_emails`, `gmail_list_drafts`, `gmail_create_draft`, `gmail_send_draft`, `gmail_send_email`, `gmail_add_label_to_email`), Google Sheets (`googlesheets_batch_get`, `googlesheets_values_get`, `googlesheets_spreadsheets_values_append`, `googlesheets_values_update`, `googlesheets_create_spreadsheet_row`, `googlesheets_upsert_rows`), X/Twitter (`x_search_recent`, `x_create_post`, `x_list_post_likers`), LinkedIn (`linkedin_create_post`, `linkedin_create_article_or_url_share`, `linkedin_get_my_info`), Instagram (`instagram_get_user_info`, `instagram_get_user_media`, `instagram_post_media`, `instagram_publish_media`, `instagram_send_text_message`, `instagram_send_image`), plus HubSpot, Notion, Slack, and YouTube reads. Examples: " +
    JSON.stringify(EXAMPLES[0]) +
    " | " +
    JSON.stringify(EXAMPLES[1]) +
    " | " +
    JSON.stringify(EXAMPLES[2]),
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
