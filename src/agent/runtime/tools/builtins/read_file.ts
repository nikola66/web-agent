import { defineTool } from "../definition.js";
import { readFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "read_file",
  run: readFileTool,
  emoji: "📄",
  description: "Read a UTF-8 file from the workspace. Returns { ok, path, bytes, content }. `bytes: 0` with `content: \"\"` means the file exists but is empty — distinct from a missing file (which throws an error).",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative or absolute (under workspace root) file path." } }, required: ["path"], additionalProperties: false },
});
