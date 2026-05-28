import { defineTool } from "../definition.js";
import { editFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "edit_file",
  run: editFileTool,
  emoji: "🛠️",
  description: "Single find/replace hunk or full replace via `new_content`. For many hunks use `multi_edit`; for patch blocks use `apply_patch`. New deliverables under `projects/<slug>/` or `work/<slug>/`.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file to edit." },
      find: { type: "string", description: "Exact text to replace (alias: old). Omit for a full-file replace." },
      replace: { type: "string", description: "Replacement text (alias: new)." },
      new_content: {
        type: "string",
        description: "Full new file contents (aliases: content, text) when not using find/replace.",
      },
    },
    required: ["path"],
    additionalProperties: true,
  },
});
