import { defineTool } from "../definition.js";
import { readFileTool } from "../filesystem-tools.js";

export default defineTool({
  name: "read_file",
  run: readFileTool,
  emoji: "📄",
  description:
    "Read a UTF-8 file. **`path`** is workspace-relative (`.` = root) — not a host path like /home/... " +
    "and not necessarily an app repo (profiles often have AGENT.md, projects/, work/ only). " +
    "Run `list_dir({\"path\":\".\"})`, `tree`, or `find_files` before guessing paths like src/... or " +
    ".webagent/package.json. Returns { ok, path, bytes, content }. Empty file: bytes 0, content \"\".",
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
