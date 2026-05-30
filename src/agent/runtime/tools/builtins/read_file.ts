import { defineTool } from "../definition.js";
import { readFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "read_file",
  run: readFileTool,
  emoji: "📄",
  description:
    "Read a UTF-8 file. **`path`** is workspace-relative (`.` = root). " +
    "Do not read `memory/runs/*.json` (agent logs) or browse `memory/snapshots/`. " +
    "When tool output has `list_digest`, use it — do not read_file the spill. " +
    "Otherwise read the exact `result_ref` once (auto-unwrapped). HTML spills need Authorization on a fresh web_fetch, not JSON.parse. " +
    "Run `browse_workspace` (action=list/tree/find) before guessing paths. Returns { ok, path, bytes, content }.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative file path confirmed via browse_workspace (e.g. package.json, projects/foo/README.md).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
});
