import { defineTool } from "../definition.js";
import { findFilesTool } from "../filesystem-tools.js";

export default defineTool({
  name: "find_files",
  run: findFilesTool,
  emoji: "🔎",
  description:
    "Find workspace files by name/path. One pattern: substring or glob (*.md, **/plan.md). " +
    "Multiple tokens: patterns: [\"ainex\",\"outreach\"] (AND) or matchMode: \"any\" for OR. " +
    "Comma-separated AND: pattern: \"ainex,outreach\". Avoid *token* globs—use patterns without stars. " +
    "Optional root/path (default `.`). Skips node_modules, dist, etc.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Single substring/glob, or comma-separated substrings (ainex,outreach) when no * or ?.",
      },
      query: { type: "string", description: "Alias for pattern." },
      patterns: {
        type: "array",
        items: { type: "string" },
        description: "Substring/glob tokens. Default AND; use matchMode \"any\" for OR.",
      },
      matchMode: {
        type: "string",
        description: "Optional: \"any\" (OR) or default AND when multiple patterns.",
      },
      root: { type: "string", description: "Search root (default `.`)." },
      path: { type: "string", description: "Alias for root." },
    },
    additionalProperties: true,
  },
});
