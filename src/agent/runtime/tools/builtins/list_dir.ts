import { defineTool } from "../definition.js";
import { listDirTool } from "../filesystem-tools.js";

const LIST_DIR_EXAMPLES = [
  { path: "." },
  { path: "projects", recursive: false },
  { path: "projects", pattern: "outreach", recursive: true },
];

export default defineTool({
  name: "list_dir",
  run: listDirTool,
  emoji: "📁",
  description:
    "List entries in **one directory**. Use `.` for workspace root. Optional `pattern` filters names " +
    "within that directory tree when `recursive` is true — for cross-tree name search use `find_files` instead. " +
    "Optional `recursive`, `kind`. " +
    "Example arguments: " +
    JSON.stringify(LIST_DIR_EXAMPLES[0]) +
    " | " +
    JSON.stringify(LIST_DIR_EXAMPLES[1]),
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative directory. Default `.` (root). Never use `/`.",
      },
      recursive: { type: "boolean", description: "Recurse into subdirectories." },
      pattern: {
        type: "string",
        description: "Optional filename/path filter (substring or glob like *.md).",
      },
      kind: {
        type: "string",
        description: "all | file | files | dir | dirs | directory",
      },
      maxResults: { type: "number" },
      maxEntriesScanned: { type: "number" },
    },
    additionalProperties: false,
    examples: LIST_DIR_EXAMPLES,
  },
});
