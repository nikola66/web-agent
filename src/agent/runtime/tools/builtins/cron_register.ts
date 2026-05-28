import { defineTool } from "../definition.js";
import { CRON_REGISTER_TOOL_DESCRIPTION } from "../cron-register-description.js";
import { cronRegisterTool } from "../remote-tools.js";

export default defineTool({
  name: "cron_register",
  run: cronRegisterTool,
  emoji: "⏱️",
  description: CRON_REGISTER_TOOL_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["register", "remove"], description: "register (default) or remove." },
      id: { type: "string", description: "Job id — required for `remove`." },
      name: { type: "string", description: "Human label for the job." },
      everyMinutes: { type: "number", description: "Heartbeat interval in minutes." },
      tool: { type: "string", description: "Single tool name to run (or use `steps`)." },
      arguments: { type: "object", additionalProperties: true, description: "Arguments for `tool`." },
      steps: {
        type: "array",
        description: "Multi-step job; each item { tool, arguments }.",
        items: { type: "object", additionalProperties: true },
      },
    },
    additionalProperties: true,
  },
});
