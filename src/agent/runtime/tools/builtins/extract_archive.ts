import { defineTool } from "../definition.js";
import { extractArchive } from "../filesystem/archive.js";

export default defineTool({
  name: "extract_archive",
  run: (args, ctx) => extractArchive(ctx, args),
  emoji: "🗜️",
  description:
    "Extract a ZIP, TAR, or TAR.GZ archive into a workspace directory. " +
    "**Read-only counterpart:** to CREATE a `.zip`, there is no `create_archive` tool — use `run_python` with stdlib `zipfile` (see `skill_view` **`browser-runtime-map`**). " +
    "Strongly prefer `archive_path` (workspace-relative). Aliases accepted: `path`, `file`, `file_path`, `zip`, `archive`. " +
    "If you call this with no path at all, the tool auto-picks the NEWEST archive in `.webagent/telegram-inbox/` " +
    "and sets `autoPickedFromInbox: true` in the result — fine when the user just sent a single file, " +
    "but pass the path explicitly when there's any ambiguity. " +
    "Optional: `destination` (defaults to `<archive>-extracted`), `max_files` (5000), `max_bytes` (256MB). " +
    "Path-traversal entries are blocked. ZIP64 / encryption / non-deflate methods are not supported. " +
    "Returns { ok, format, extractedFiles, extractedBytes, skipped, autoPickedFromInbox? }.",
  inputSchema: {
    type: "object",
    properties: {
      archive_path: {
        type: "string",
        description: "Workspace-relative path to a .zip / .tar / .tar.gz / .tgz file. Aliases: `path`, `file`, `file_path`, `zip`, `archive`.",
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
    additionalProperties: true,
  },
});
