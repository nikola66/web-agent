import { defineTool } from "../definition.js";
import { makeDirTool } from "../filesystem-tools.js";

export default defineTool({
  name: "make_dir",
  run: makeDirTool,
  emoji: "📂",
  description: "Create a directory path recursively inside the workspace. For a new isolated tree (demo, spike, harness), prefer `projects/<slug>/` or `work/<slug>/` before writing sibling files under it.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Target directory path inside the current workspace." } }, required: ["path"], additionalProperties: false },
});
