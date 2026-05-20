import { defineTool } from "../definition.js";
import { emailTool } from "../email-tools.js";

const EMAIL_INPUT_EXAMPLES = [
  { action: "self_test" },
  { action: "send", to: "you@example.com", subject: "Hello", text: "Plain text body." },
  { to: "you@example.com", subject: "Hello", text: "You may omit action; defaults to send when all three are set." },
];

export default defineTool({
  name: "email",
  run: emailTool,
  emoji: "✉️",
  description:
    "Send outbound email via Resend (HTTP API). Configure in Settings → Email. Actions: `self_test` (Resend credentials), `send` ({to, subject, text, from?, html?}). Resend requires primary `to` (not cc-only). Prefer flat fields; nested `arguments` is merged for non-cron calls. For cron / `.webagent/cronjobs.json`, you may omit `action` when `to`, `subject`, and `text` are all set — it defaults to `send`. `send` may require approval when confirmations are enabled. Examples (arguments JSON only): " +
    JSON.stringify(EMAIL_INPUT_EXAMPLES[0]) +
    " | " +
    JSON.stringify(EMAIL_INPUT_EXAMPLES[1]) +
    " | " +
    JSON.stringify(EMAIL_INPUT_EXAMPLES[2]),
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "`self_test` or `send` (inferred when to+subject+text set)." },
      to: { type: "string", description: "Primary recipient (required for send)." },
      subject: { type: "string", description: "Subject line (required for send)." },
      text: { type: "string", description: "Plain text body (required for send)." },
      from: { type: "string", description: "Optional From; defaults to configured Resend from." },
      html: { type: "string", description: "Optional HTML body." },
    },
    required: [],
    additionalProperties: true,
    examples: EMAIL_INPUT_EXAMPLES,
  },
});
