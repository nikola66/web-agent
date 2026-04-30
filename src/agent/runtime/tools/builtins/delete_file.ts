import { defineTool } from "../definition.js";
import { deleteFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "delete_file",
  run: deleteFileTool,
  emoji: "🗑️",
  description: "Delete a file from the workspace. Accepts workspace-relative or absolute path under workspace root.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "File path inside the current workspace." } }, required: ["path"], additionalProperties: false },
  requiresConfirmation: true,
  approvalSummary: "delete_file: {{path}}",
});
