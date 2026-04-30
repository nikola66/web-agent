import { defineTool } from "../definition.js";
import { memoryRecallTool } from "../remote-tools.js";

export default defineTool({
  name: "memory_recall",
  run: memoryRecallTool,
  emoji: "🧠",
  description: "Recall a single saved memory fact by its exact `key`. Use `memory_search` instead when you only have a topic or substring.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
