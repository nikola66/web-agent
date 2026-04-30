import { defineTool } from "../definition.js";
import { CRON_REGISTER_TOOL_DESCRIPTION } from "../cron-register-description.js";
import { cronRegisterTool } from "../remote-tools.js";

export default defineTool({
  name: "cron_register",
  run: cronRegisterTool,
  emoji: "⏱️",
  description: CRON_REGISTER_TOOL_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
