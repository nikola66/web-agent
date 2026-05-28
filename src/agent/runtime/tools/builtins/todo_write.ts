import { defineTool } from "../definition.js";
import { todoWriteTool } from "../remote-tools.js";

export default defineTool({
  name: "todo_write",
  run: todoWriteTool,
  emoji: "✅",
  description:
    "Create or update checklist-style todos. Pass `todos`: an array of `{ id, text, status }` " +
    "(status one of pending|in_progress|done). `items`/`tasks` are accepted aliases for `todos`, " +
    "and `text`/`title`/`task` for the label. Replaces the full list each call.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "Full todo list (replaces previous). Each item: { id, text, status }.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Stable id (string or number)." },
            text: { type: "string", description: "Todo label. Aliases: title, task, content." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done"],
              description: "Defaults to pending.",
            },
          },
          required: ["text"],
        },
      },
    },
    additionalProperties: true,
  },
});
