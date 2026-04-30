import { defineTool } from "../definition.js";
import { sessionMemoryRecallTool } from "../remote-tools.js";

export default defineTool({
  name: "session_memory_list",
  run: sessionMemoryRecallTool,
  emoji: "🗂️",
  description: "Read the newest N entries from rolling session memory (see session_memory_append).",
  inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max lines to return (default 30, max 200)." } }, additionalProperties: false },
});
