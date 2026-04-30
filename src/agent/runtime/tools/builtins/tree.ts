import { defineTool } from "../definition.js";
import { treeTool } from "../filesystem-tools.js";

export default defineTool({
  name: "tree",
  run: treeTool,
  emoji: "🌲",
  description: "Render a directory tree view with bounded traversal. Skips heavy directories (e.g. node_modules, dist).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
