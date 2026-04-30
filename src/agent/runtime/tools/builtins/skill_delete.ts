import { defineTool } from "../definition.js";
import { skillDeleteTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_delete",
  run: skillDeleteTool,
  emoji: "🗑️",
  description: "Delete a saved skill from the workspace skills library by name. Convenience wrapper for skill_manage delete; requires explicit user approval.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  requiresConfirmation: true,
});
