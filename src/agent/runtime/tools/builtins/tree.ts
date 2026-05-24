import { defineTool } from "../definition.js";
import { treeTool } from "../filesystem-tools.js";

export default defineTool({
  name: "tree",
  run: treeTool,
  emoji: "🌲",
  llmVisible: false,
  toolGroup: "core",
  description:
    "Render a directory tree (bounded depth). Use on `.` first to learn workspace layout before read_file. " +
    "Skips node_modules, dist, etc.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative root (default `.`)." },
      maxDepth: { type: "number" },
      maxEntries: { type: "number" },
    },
    additionalProperties: true,
  },
});
