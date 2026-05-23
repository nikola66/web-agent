import { defineTool } from "../definition.js";
import { listArchive } from "../filesystem/archive.js";

export default defineTool({
  name: "archive_list",
  run: listArchive as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "📦",
  description:
    "List entries inside a ZIP / TAR / TAR.GZ archive without extracting. " +
    "Strongly prefer `archive_path` (workspace-relative). Aliases accepted: `path`, `file`, `file_path`, `zip`, `archive`. " +
    "If called with no path, auto-picks the NEWEST archive in `.webagent/telegram-inbox/` and sets `autoPickedFromInbox: true`. " +
    "Optional: `limit` (default 500, max 5000). " +
    "Returns { ok, format, totalEntries, totalUncompressedBytes, entries: [{ name, size, compressedSize, isDir, method }], truncated, autoPickedFromInbox? }.",
  inputSchema: {
    type: "object",
    properties: {
      archive_path: {
        type: "string",
        description: "Workspace-relative path to a .zip / .tar / .tar.gz / .tgz file. Aliases: `path`, `file`, `file_path`, `zip`, `archive`.",
      },
      limit: {
        type: "number",
        description: "Maximum entries to return (default 500, max 5000).",
      },
    },
    additionalProperties: true,
  },
});
