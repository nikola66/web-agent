import { defineTool } from "../definition.js";
import { findFilesTool } from "../filesystem-tools.js";

export default defineTool({
  name: "find_files",
  run: findFilesTool,
  emoji: "🔎",
  description:
    "Find workspace files by name. Bare tokens match substrings (outreach_plan → outreach_plan.md). " +
    "Use globs for extension/path filters (*.md, **/plan.md). Skips node_modules, dist, etc. " +
    "Accepts `pattern` or `query`; optional `root`/`path` (default `.`).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
