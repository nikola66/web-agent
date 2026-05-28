import { defineTool } from "../definition.js";
import { multiEditTool } from "../filesystem-tools.js";

export default defineTool({
  name: "multi_edit",
  run: multiEditTool,
  emoji: "🛠️",
  description: "Multiple find/replace edits in one file. For a single hunk use `edit_file`; for unified patch blocks use `apply_patch`. Anchor new work under `projects/<slug>/` or `work/<slug>/`.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file to edit." },
      edits: {
        type: "array",
        description: "Edits applied in order. Each item: { find/old, replace/new }.",
        items: { type: "object", additionalProperties: true },
      },
    },
    required: ["path", "edits"],
    additionalProperties: true,
  },
});
