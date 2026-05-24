import { defineTool } from "../definition.js";
import { editFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "edit_file",
  run: editFileTool,
  emoji: "🛠️",
  description: "Single find/replace hunk or full replace via `new_content`. For many hunks use `multi_edit`; for patch blocks use `apply_patch`. New deliverables under `projects/<slug>/` or `work/<slug>/`.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
