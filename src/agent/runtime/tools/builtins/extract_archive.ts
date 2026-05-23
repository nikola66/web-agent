import { defineTool } from "../definition.js";
import { extractArchive } from "../filesystem/archive.js";

export default defineTool({
  name: "extract_archive",
  run: extractArchive as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "🗜️",
  description:
    "Extract a ZIP, TAR, or TAR.GZ archive into a workspace directory. " +
    "Required: `archive_path` (workspace-relative; aliases accepted: `path`, `file`, `file_path`, `zip`, `archive`). " +
    "Files sent over Telegram land in `.webagent/telegram-inbox/` — call `list_dir` there if unsure. " +
    "Optional: `destination` (defaults to `<archive>-extracted`), `max_files` (5000), `max_bytes` (256MB). " +
    "Path-traversal entries are blocked. ZIP64 / encryption / non-deflate methods are not supported. " +
    "Returns { ok, format, extractedFiles, extractedBytes, skipped }.",
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
    required: ["archive_path"],
    additionalProperties: true,
  },
});
