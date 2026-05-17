import { defineTool } from "../definition.js";
import { wikiSyncTool } from "../wiki-tools.js";

export default defineTool({
  name: "wiki_sync",
  run: wikiSyncTool,
  emoji: "🔁",
  description:
    "Project runtime memory into the wiki vault: updates Resources/KnowledgeVault/index.md (between WIKI_SYNC markers), appends to log.md, writes ops/wiki-sync-*.md. scope: facts | session | all (all includes learnings). Requires wiki_setup first.",
  inputSchema: {
    type: "object",
    properties: {
      root_path: {
        type: "string",
        description: "Workspace-relative vault root (default: .webagent/knowledge-vault).",
      },
      scope: {
        type: "string",
        description: "facts | session | all",
        enum: ["facts", "session", "all"],
      },
      max_items: {
        type: "number",
        description: "Cap rows pulled per source (default 40, max 200).",
      },
    },
    additionalProperties: false,
  },
});
