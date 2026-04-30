import { defineTool } from "../definition.js";
import { skillViewTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_view",
  run: skillViewTool,
  emoji: "📖",
  description: "Load a skill's full SKILL.md or an allowed support file. Use this after skill_list and before following detailed skill instructions.",
  inputSchema: { type: "object", properties: { name: { type: "string", description: "Skill name or slug." }, file_path: { type: "string", description: "Optional skill-relative path. Defaults to SKILL.md. Allowed support roots: references/, templates/, scripts/, assets/." } }, required: ["name"], additionalProperties: false },
});
