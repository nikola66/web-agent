import { defineTool } from "../definition.js";
import { memoryForgetTool } from "../remote-tools.js";

export default defineTool({
  name: "memory_forget",
  run: memoryForgetTool,
  emoji: "🧹",
  description:
    "Delete one durable memory fact by exact `key`. Use when a saved fact is stale, wrong, or the user asks you to forget it. " +
    "Use `memory_search` first if you only know the topic.",
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Exact saved memory key to delete.",
      },
    },
    required: ["key"],
    additionalProperties: false,
    examples: [{ key: "old_project_codename" }],
  },
});
