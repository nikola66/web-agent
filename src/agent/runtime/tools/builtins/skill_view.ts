import { defineTool } from "../definition.js";
import { skillViewTool } from "../remote-tools.js";

const SKILL_VIEW_EXAMPLES = [
  { name: "http-api" },
  { name: "memory-layers" },
  { name: "script-porting", file_path: "references/porting-cheatsheet.md" },
];

export default defineTool({
  name: "skill_view",
  run: skillViewTool,
  emoji: "📖",
  description:
    "Load a skill's full SKILL.md or an allowed support file. Use after skill_list and before following detailed skill instructions. " +
    "Required argument key is **`name`** (the skill slug, e.g. http-api) — do not use `slug`. " +
    'Example: {"name":"http-api"}.',
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Skill identifier (same value as the /slash slug, e.g. http-api, memory-layers). JSON key must be `name`, not `slug`.",
      },
      file_path: {
        type: "string",
        description:
          "Optional skill-relative path. Defaults to SKILL.md. Allowed support roots: references/, templates/, scripts/, assets/.",
      },
    },
    required: ["name"],
    additionalProperties: false,
    examples: SKILL_VIEW_EXAMPLES,
  },
});
