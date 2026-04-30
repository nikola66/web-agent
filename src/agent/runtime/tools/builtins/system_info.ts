import { defineTool } from "../definition.js";
import { systemInfoTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "system_info",
  run: systemInfoTool,
  emoji: "📟",
  description: "Safe system snapshot: `time` (ISO-8601) and `timezone`, uptime, memory, OS/Node, optional disk stats, workspace `statfs` when available. Prefer this over run_shell/date for the current clock. Read-only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
