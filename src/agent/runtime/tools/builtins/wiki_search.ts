import { defineTool } from "../definition.js";
import { wikiSearchTool } from "../wiki-tools.js";

export default defineTool({
  name: "wiki_search",
  run: wikiSearchTool,
  emoji: "🔎",
  description:
    "Full-text search markdown files under the wiki vault root (default .webagent/knowledge-vault). Returns ranked matches with snippets when memory_search is insufficient.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords to find (2+ char tokens)." },
      root_path: {
        type: "string",
        description: "Workspace-relative vault root (default: .webagent/knowledge-vault).",
      },
      limit: { type: "number", description: "Max matches (default 10, max 50)." },
      max_files: {
        type: "number",
        description: "Max .md files to scan (default 500, max 2000).",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
});
