import { defineTool } from "../definition.js";
import { extractArchive } from "../filesystem/archive.js";

export default defineTool({
  name: "extract_archive",
  run: extractArchive as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "🗜️",
  description:
    "Extract a ZIP, TAR, or TAR.GZ archive into a workspace directory. " +
    "Required: `archive_path` (workspace-relative). Optional: `destination` (defaults to `<archive>-extracted`), " +
    "`max_files` (default 5000), `max_bytes` (default 256MB). Path-traversal entries are blocked. " +
    "ZIP64 / encryption / non-deflate methods are not supported — call `run_shell` with a node script for exotic archives. " +
    "Returns { ok, format, extractedFiles, extractedBytes, skipped }.",
  inputSchema: {
    type: "object",
    properties: {
      archive_path: {
        type: "string",
        description: "Workspace-relative path to a .zip / .tar / .tar.gz / .tgz file.",
      },
      destination: {
        type: "string",
        description: "Workspace-relative directory to extract into. Defaults to `<archive>-extracted`.",
      },
      max_files: {
        type: "number",
        description: "Cap on extracted entries (default 5000). Excess listed in `skipped`.",
      },
      max_bytes: {
        type: "number",
        description: "Cap on total uncompressed bytes written (default 256MB).",
      },
    },
    required: ["archive_path"],
    additionalProperties: false,
  },
});
