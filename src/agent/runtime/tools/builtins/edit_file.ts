import { defineTool } from "../definition.js";
import { editFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "edit_file",
  run: editFileTool,
  emoji: "🛠️",
  description: "Edit a file either by replacing the first matching snippet (`find` + `replace`) or by fully replacing file contents (`new_content`). New deliverables belong under `projects/<slug>/` or `work/<slug>/`; avoid new loose top-level directories or root-level files unrelated to workspace config—the root write guard may reject them.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
