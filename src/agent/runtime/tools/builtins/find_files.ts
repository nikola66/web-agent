import { defineTool } from "../definition.js";
import { findFilesTool } from "../filesystem-tools.js";

export default defineTool({
  name: "find_files",
  run: findFilesTool,
  emoji: "🔎",
  description: "Find files by glob-like name pattern with bounded scan defaults. Skips heavy directories (e.g. node_modules, dist).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
