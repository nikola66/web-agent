import { defineTool } from "../definition.js";
import { grepTool } from "../filesystem-tools.js";

export default defineTool({
  name: "grep",
  run: grepTool,
  emoji: "🔍",
  description:
    "Search file contents for text (case-insensitive substring) or regex. Skips heavy directories. " +
    "Optional `root` (default `.`); raise maxFilesScanned on large repos.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
