import { defineTool } from "../definition.js";
import { fileDiffTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "file_diff",
  run: fileDiffTool,
  emoji: "🧾",
  description: "Line-oriented text diff between two UTF-8 workspace files. Returns a simple +/- diff (not unified diff format).",
  inputSchema: { type: "object", properties: { path_a: { type: "string", description: "Workspace-relative path to file A." }, path_b: { type: "string", description: "Workspace-relative path to file B." } }, required: ["path_a", "path_b"], additionalProperties: false },
});
