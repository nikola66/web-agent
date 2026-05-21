import { defineTool, strictObjectSchema } from "../definition.js";
import { skillManageTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_manage",
  run: skillManageTool,
  emoji: "🧩",
  description:
    "Create, patch, edit, delete, import, or manage support files for reusable SKILL.md skills. " +
    "Actions: create (name+content), patch/edit (name+content), delete (name — requires user approval), " +
    "install_url/import_url (url — raw GitHub SKILL.md, github tree path, or skillsmp/skills.sh page; " +
    "Nodebox uses web_fetch proxy). Applies immediately except delete. " +
    "For two or more skills or URLs in one request, prefer skill_bulk_save (one approval).",
  inputSchema: strictObjectSchema(
    {
      action: {
        type: "string",
        enum: ["create", "patch", "edit", "delete", "install_url", "import_url", "write_file"],
        description: "Operation to perform.",
      },
      name: { type: "string", description: "Skill name or slug." },
      content: { type: "string", description: "SKILL.md body for create/patch/edit." },
      description: { type: "string", description: "Short discovery description for create." },
      url: {
        type: "string",
        description:
          "HTTPS URL: raw.githubusercontent.com/.../SKILL.md, github.com/.../tree/.../skill-dir, or skillsmp/skills.sh page.",
      },
      file_path: { type: "string", description: "Support file path relative to skill folder." },
    },
    ["action"],
    [
      { action: "create", name: "deploy-checklist", content: "# Deploy\n\n1. Run tests\n2. Ship" },
      { action: "delete", name: "obsolete-skill" },
      { action: "install_url", url: "https://example.com/SKILL.md" },
    ]
  ),
});
