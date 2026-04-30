import { defineTool } from "../definition.js";
import { moveFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "move_file",
  run: moveFileTool,
  emoji: "📦",
  description: "Move or rename a file path.",
  inputSchema: { type: "object", properties: { from: { type: "string", description: "Existing source path inside the workspace." }, to: { type: "string", description: "Destination path inside the workspace." } }, required: ["from", "to"], additionalProperties: false },
});
