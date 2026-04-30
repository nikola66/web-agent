import { defineTool } from "../definition.js";
import { emailTool } from "../email-tools.js";

export default defineTool({
  name: "email",
  run: emailTool,
  emoji: "✉️",
  description: "Send outbound email via Resend (HTTP API). Configure in Settings → Email. Actions: `self_test` (Resend credentials), `send` ({to, subject, text, from?, html?}). For cron / `.cronjobs.json`, you may omit `action` when `to`, `subject`, and `text` are all set — it defaults to `send`. `send` may require approval when confirmations are enabled.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
