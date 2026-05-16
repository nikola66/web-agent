import { defineTool } from "../definition.js";
import { wikiSetupTool } from "../wiki-tools.js";

export default defineTool({
  name: "wiki_setup",
  run: wikiSetupTool,
  emoji: "📚",
  description:
    "Create a PARA-style vault + Obsidian wiki scaffold under `root_path` (default knowledge-vault): Projects, Areas, Resources/KnowledgeVault/{sources,entities,concepts,synthesis,ops}, Archives, index.md, log.md. Idempotent: skips existing files unless overwrite=true.",
  inputSchema: {
    type: "object",
    properties: {
      root_path: {
        type: "string",
        description: "Workspace-relative vault root (default: knowledge-vault).",
      },
      mode: {
        type: "string",
        description: "Only para_plus_wiki is supported.",
        enum: ["para_plus_wiki"],
      },
      overwrite: {
        type: "boolean",
        description: "If true, rewrite scaffold markdown files that already exist.",
      },
    },
    additionalProperties: false,
  },
});
