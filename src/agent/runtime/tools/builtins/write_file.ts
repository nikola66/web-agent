import { defineTool } from "../definition.js";
import { writeFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "write_file",
  run: writeFileTool,
  emoji: "✍️",
  description: "Write text to a file, creating parents as needed. Required: `path` (workspace-relative; use a subfolder such as `work/<slug>/` or `projects/<slug>/` for deliverables—bare root names are restricted) and `content` (string). `filename` / `file` are accepted as aliases for `path` when models use artifact-style arguments. For JSON files, pre-serialize with JSON.stringify. Returns { ok, path, bytes }.",
  inputSchema: { type: "object", properties: { path: { type: "string", description: "Workspace-relative file path (e.g. work/run/file.md)." }, content: { type: "string", description: "Exact file contents as a string." } }, required: ["path", "content"], additionalProperties: true },
});
