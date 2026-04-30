import { defineTool } from "../definition.js";
import { listDirTool } from "../filesystem-tools.js";

export default defineTool({
  name: "list_dir",
  run: listDirTool,
  emoji: "📁",
  description: "List and find workspace entries (files/directories) with optional recursion and glob-like filtering.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
