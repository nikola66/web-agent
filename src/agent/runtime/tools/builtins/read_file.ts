import { defineTool } from "../definition.js";
import { readFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "read_file",
  run: readFileTool,
  emoji: "📄",
  description:
    "Read a UTF-8 file. **`path`** is workspace-relative (`.` = root). " +
    "Do not read `memory/runs/*.json` (agent logs) or browse `memory/snapshots/` except the exact `result_ref` from tool output (auto-unwrapped). " +
    "For API data, rerun `web_fetch`/`web_post` instead of scavenging memory archives. " +
    "Run `list_dir({\"path\":\".\"})`, `tree`, or `find_files` before guessing paths. Returns { ok, path, bytes, content }.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative file path confirmed via list_dir/tree/find_files (e.g. package.json, projects/foo/README.md).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
});
