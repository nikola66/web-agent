import { defineTool, strictObjectSchema } from "../definition.js";
import { skillManageTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_manage",
  run: skillManageTool,
  emoji: "🧩",
  description:
    "Create, patch, edit, delete, import, or manage support files for reusable SKILL.md skills. " +
    "Actions: create (name+content, or full SKILL.md content with frontmatter), " +
    "patch (name+old_string+new_string), edit (name+full SKILL.md content), " +
    "write_file (name+file_path+content; SKILL.md allowed), delete (name — requires user approval), " +
    "install_url/import_url (url — raw GitHub SKILL.md, github tree path, or skillsmp/skills.sh page; " +
    "import_dir/install_dir (path — extracted skill folder; saves SKILL.md plus references/templates/scripts/assets), " +
    "Nodebox uses web_fetch proxy). Applies immediately except delete. " +
    "For two or more skills or URLs in one request, prefer skill_bulk_save (one approval).",
  inputSchema: strictObjectSchema(
    {
      action: {
        type: "string",
        enum: ["create", "patch", "edit", "delete", "install_url", "import_url", "import_dir", "install_dir", "write_file"],
        description: "Operation to perform.",
      },
      name: {
        type: "string",
        description: "Skill identifier. JSON key must be `name` (not `slug`).",
      },
      content: { type: "string", description: "SKILL.md body for create/patch/edit." },
      old_string: { type: "string", description: "Existing text for patch action." },
      new_string: { type: "string", description: "Replacement text for patch action." },
      description: { type: "string", description: "Short discovery description for create." },
      category: { type: "string", description: "Optional category for create/import." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for create." },
      version: { type: "string", description: "Optional version for create." },
      absorbed_into: { type: "string", description: "Optional replacement skill when deleting." },
      url: {
        type: "string",
        description:
          "HTTPS URL: raw.githubusercontent.com/.../SKILL.md, github.com/.../tree/.../skill-dir, or skillsmp/skills.sh page.",
      },
      path: { type: "string", description: "Workspace-relative extracted skill folder for import_dir/install_dir." },
      file_path: { type: "string", description: "Support file path relative to skill folder." },
    },
    ["action"],
    [
      { action: "create", name: "deploy-checklist", content: "# Deploy\n\n1. Run tests\n2. Ship" },
      { action: "patch", name: "deploy-checklist", old_string: "Run tests", new_string: "Run tests first" },
      { action: "write_file", name: "deploy-checklist", file_path: "references/notes.md", content: "# Notes\n" },
      { action: "delete", name: "obsolete-skill" },
      { action: "install_url", url: "https://example.com/SKILL.md" },
      { action: "import_dir", path: "work/skill.zip-extracted/directus-5lang-blog-publisher" },
    ]
  ),
});
