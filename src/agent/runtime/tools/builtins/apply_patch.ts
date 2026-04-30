import { defineTool } from "../definition.js";
import { applyPatchTool } from "../filesystem-tools.js";

export default defineTool({
  name: "apply_patch",
  run: applyPatchTool,
  emoji: "🩹",
  description: "Apply unified patch operations. Supports `*** Add File:` and `*** Update File:` blocks inside `*** Begin Patch`/`*** End Patch`. For **new** adds, prefer targets under `projects/<slug>/` or `work/<slug>/` (make_dir first), not stray top-level clutter; workspace root rejects most new basenames.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
