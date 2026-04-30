import { defineTool } from "../definition.js";
import { memorySaveTool } from "../remote-tools.js";

export default defineTool({
  name: "memory_save",
  run: memorySaveTool,
  emoji: "💾",
  description: "Save a durable memory fact under a stable key. Always provide both `key` (short, snake_case identifier such as `user_timezone` or `preferred_editor`) and `value` (the content to remember; can be a string, number, boolean, object, or array). Calling without `key` will fail.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
