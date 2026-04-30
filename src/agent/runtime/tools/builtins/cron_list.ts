import { defineTool } from "../definition.js";
import { cronListTool } from "../remote-tools.js";

export default defineTool({
  name: "cron_list",
  run: cronListTool,
  emoji: "📋",
  description: "List heartbeat cron jobs from `.cronjobs.json` (same store the runtime uses when the tab heartbeat ticks). Each job includes `delivery` (silent | terminal | email) and optional email/Telegram fields. Use before `cron_register` to avoid duplicate ids. Jobs run only while the app is open.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
