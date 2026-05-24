import { defineTool } from "../definition.js";
import { multiEditTool } from "../filesystem-tools.js";

export default defineTool({
  name: "multi_edit",
  run: multiEditTool,
  emoji: "🛠️",
  description: "Multiple find/replace edits in one file. For a single hunk use `edit_file`; for unified patch blocks use `apply_patch`. Anchor new work under `projects/<slug>/` or `work/<slug>/`.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
