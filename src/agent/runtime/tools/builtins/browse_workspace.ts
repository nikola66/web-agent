import { defineTool } from "../definition.js";
import { findFilesTool, listDirTool } from "../filesystem/list.js";
import { treeTool } from "../filesystem/search.js";

type BrowseAction = "list" | "tree" | "find";

async function browseWorkspaceTool(rawArgs: Record<string, unknown> = {}, ctx: unknown) {
  const action = String(rawArgs.action || "list").trim().toLowerCase() as BrowseAction;
  if (action === "tree") return treeTool(rawArgs, ctx);
  if (action === "find") return findFilesTool(rawArgs, ctx);
  return listDirTool(rawArgs, ctx);
}

export default defineTool({
  name: "browse_workspace",
  run: browseWorkspaceTool,
  emoji: "📁",
  toolGroup: "core",
  description:
    "Browse the workspace by action. **`list`** — one directory (`path`, optional `recursive`, `pattern`, `kind`). " +
    "**`tree`** — bounded directory tree (`path`, `maxDepth`, `maxEntries`). " +
    "**`find`** — cross-tree file search by name (`pattern`/`patterns`, optional `root`). " +
    "For file contents use `grep`; to read a file use `read_file`.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "tree", "find"],
        description: "Browse mode: list one directory, render a tree, or find files by name.",
      },
      path: { type: "string", description: "Workspace-relative directory (list/tree). Default `.`." },
      root: { type: "string", description: "Search root for find action (alias: path)." },
      recursive: { type: "boolean", description: "Recurse when action=list." },
      pattern: { type: "string", description: "Name filter (list/find) or comma-separated AND tokens (find)." },
      patterns: {
        type: "array",
        items: { type: "string" },
        description: "Multiple find tokens (AND by default; matchMode any for OR).",
      },
      matchMode: { type: "string", description: "find only: any (OR) or default AND." },
      query: { type: "string", description: "Alias for pattern on find." },
      kind: { type: "string", description: "list only: all | file | files | dir | dirs | directory." },
      maxDepth: { type: "number", description: "tree only: max depth." },
      maxEntries: { type: "number", description: "tree only: max entries." },
      maxResults: { type: "number", description: "list only: max results." },
      maxEntriesScanned: { type: "number", description: "list only: scan cap." },
    },
    required: ["action"],
    additionalProperties: true,
  },
});
