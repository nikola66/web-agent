import { defineTool } from "../definition.js";
import { multiEditTool } from "../filesystem-tools.js";

export default defineTool({
  name: "multi_edit",
  run: multiEditTool,
  emoji: "🛠️",
  description: "Apply multiple find/replace edits in one file. New multi-file efforts should anchor under `projects/<slug>/` or `work/<slug>/` (make_dir first); avoid sprinkling unrelated new files at workspace root—the root guard may reject many basenames there.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
