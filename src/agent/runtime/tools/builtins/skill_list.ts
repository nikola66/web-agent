import { defineTool } from "../definition.js";
import { skillListTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_list",
  run: skillListTool,
  emoji: "📋",
  description: "Discover saved skills in the workspace skills library. Use this to search names, descriptions, tags, categories, and paths before loading details with skill_view.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
