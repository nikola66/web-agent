import { defineTool } from "../definition.js";
import { skillRecallTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_recall",
  run: skillRecallTool,
  emoji: "🔍",
  description: "Backward-compatible raw SKILL.md loader by name. Prefer skill_view for normal skill inspection and support-file reads.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
