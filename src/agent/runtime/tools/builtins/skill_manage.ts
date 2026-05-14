import { defineTool } from "../definition.js";
import { skillManageTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_manage",
  run: skillManageTool,
  emoji: "🧠",
  description:
    "Create, patch, edit, delete, import, or manage support files for reusable SKILL.md skills. Applies immediately without a confirmation prompt. Import one remote SKILL.md with `action: install_url` or `import_url` and `url`. When adding two or more skills or URLs in one user request, prefer skill_bulk_save (one approval). When the user should explicitly confirm removal of a saved skill by name, use skill_delete instead of delete here.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
