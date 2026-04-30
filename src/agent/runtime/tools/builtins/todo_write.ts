import { defineTool } from "../definition.js";
import { todoWriteTool } from "../remote-tools.js";

export default defineTool({
  name: "todo_write",
  run: todoWriteTool,
  emoji: "✅",
  description: "Create or update checklist-style todos.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
