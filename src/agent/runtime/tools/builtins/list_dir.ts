import { defineTool } from "../definition.js";
import { listDirTool } from "../filesystem-tools.js";

export default defineTool({
  name: "list_dir",
  run: listDirTool,
  emoji: "📁",
  description:
    "List workspace entries with optional recursion. Bare `pattern` matches filename substrings; " +
    "use * globs for extension filters. Skips heavy directories (e.g. node_modules, dist).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
