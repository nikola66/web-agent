import { defineTool } from "../definition.js";
import { applyPatchTool } from "../filesystem-tools.js";

export default defineTool({
  name: "apply_patch",
  run: applyPatchTool,
  emoji: "🩹",
  description: "Unified patch blocks (`*** Begin Patch`). For single hunk use `edit_file`; for many inline replacements use `multi_edit`. Prefer targets under `projects/<slug>/` or `work/<slug>/`.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "string",
        description: "Unified patch text bounded by `*** Begin Patch` / `*** End Patch`.",
      },
    },
    required: ["patch"],
    additionalProperties: true,
  },
});
