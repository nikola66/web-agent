import { defineTool } from "../definition.js";
import { cronListTool } from "../remote-tools.js";

export default defineTool({
  name: "cron_list",
  run: cronListTool,
  emoji: "📋",
  description:
    "List heartbeat cron jobs from `.webagent/cronjobs.json`. Each job includes enriched scheduling: `schedulingMode` (heartbeat_gated), `manualRunSupported` (false), `nextEligibleAtMs`, `outputDestination` (Silent | Web UI | Web UI + Telegram | Email), and `schedulingNote`. Top-level `scheduling` repeats global rules. Use before `cron_register`. Jobs run only while the tab is open — no manual trigger.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
