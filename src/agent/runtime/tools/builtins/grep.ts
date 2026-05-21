import { defineTool } from "../definition.js";
import { grepTool } from "../filesystem-tools.js";

const GREP_EXAMPLES = [
  { pattern: "TODO|FIXME", root: "." },
  { pattern: "version", root: "." },
  { pattern: "workspace_audit", root: "work" },
];

export default defineTool({
  name: "grep",
  run: grepTool,
  emoji: "🔍",
  description:
    "Search file **contents** under a workspace path. Required: **`pattern`** (not `query` — that is " +
    "for session_search). Optional **`root`**: workspace-relative **directory** to recurse (default `.`) " +
    "or a **single file** to search. Run `list_dir` or `find_files` first — do not assume src/ paths exist.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Text or regex to find inside files (required).",
      },
      root: {
        type: "string",
        description:
          "Workspace-relative directory (default `.`) or a single file path to search in place.",
      },
      regex: { type: "boolean", description: "Treat pattern as RegExp when true." },
      maxResults: { type: "number" },
      maxFilesScanned: { type: "number" },
    },
    required: ["pattern"],
    additionalProperties: false,
    examples: GREP_EXAMPLES,
  },
});
