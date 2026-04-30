import { defineTool } from "../definition.js";
import { skillSaveTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_save",
  run: skillSaveTool,
  emoji: "📚",
  description: "Create a reusable SKILL.md procedure in the workspace skills library. Convenience wrapper for skill_manage create; saves immediately without a confirmation prompt. If you are creating two or more skills in the same user request, use skill_bulk_save instead (batch requires one approval).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
