/**
 * Runtime filesystem orientation for the agent.
 *
 * The agent runs inside an in-browser Nodebox sandbox rooted at the workspace
 * directory. The host application source (MCP client/host, the IPC adapter, and
 * the host-side tool implementations) lives OUTSIDE this sandbox and is not
 * reachable by any file tool. Without an explicit map the agent wastes turns
 * grepping the workspace for host code that physically isn't there, and
 * second-guesses where its own state files live.
 *
 * `buildWorkspaceMapBlock()` is appended to the system prompt; the same content
 * is written to `.webagent/workspace-map.md` so it is also discoverable via
 * `read_file` and the Files explorer.
 */

import fs from "node:fs/promises";
import {
  WORKSPACE_MAP_REL,
  getMemoryRoot,
  getWorkspaceRoot,
  workspaceStatePath,
} from "./constants.js";
import { ensureParentDir } from "./workspace-paths.js";

/** Single source of truth for the orientation text. Derived from runtime path constants so it can't drift. */
export function buildWorkspaceMapBlock(): string {
  const root = getWorkspaceRoot();
  const memory = getMemoryRoot();
  return [
    "# Workspace & filesystem",
    "",
    `You run inside an in-browser Nodebox sandbox. Your workspace root is \`${root}\`.`,
    "Every file tool (read_file, write_file, grep, find_files, list_dir, tree, browse_workspace)",
    "resolves paths under this root — relative paths anchor here and the root is the boundary",
    "(paths that escape it are rejected). The workspace root itself is reserved: put deliverables",
    "under `projects/<slug>/` or `work/<slug>/` (make_dir first), not at the root.",
    "",
    "## What lives here, and what persists",
    "Persisted across sessions (your durable state — safe to read and edit):",
    "- `.webagent/skills/`, `.webagent/capabilities/`, `.webagent/knowledge-vault/`, `.webagent/checkpoints/`",
    "- `.webagent/mcp-servers.json`, `.webagent/mcp-secrets.json`, `.webagent/tool-policy.json`",
    "- `.webagent/history.json`, `.webagent/todos.json`, `.webagent/cronjobs.json`, `.webagent/session-memory.jsonl`,",
    "  `.webagent/channel-state.json`, `.webagent/heartbeat-state.json`, `.webagent/composio-actions.jsonl`",
    "- `plans/` (saved `/plan` markdown)",
    `- \`${memory}/\` (long-term memory: conversations, runs, reflections, snapshots, memory.sqlite)`,
    "",
    "System-seeded and EPHEMERAL — regenerated on every launch, do not hand-edit (changes are lost):",
    "- `.webagent/tools.json`, `.webagent/providers.json`, `.webagent/browseragent.json`, `.webagent/channels.json`",
    "- `.webagent/tools-capability-index.md`, `.webagent/workspace-map.md` (this map), `agent.js`",
    "",
    "## The sandbox boundary (read this before debugging the runtime)",
    "The host application's OWN source code is NOT in this workspace and cannot be found with",
    "grep / find_files / read_file. That includes the MCP client and host, the IPC adapter that",
    "bridges your tool calls to the browser, and the host-side implementations of your tools.",
    "Searching the workspace for symbols like `McpHost`, the IPC adapter, or `mcp_reload` will",
    "always come up empty — that code runs in the host process, outside the sandbox.",
    "",
    "To debug MCP: inspect/edit `.webagent/mcp-servers.json` and `.webagent/mcp-secrets.json`,",
    "use the MCP tools, and probe servers directly with `web_post`. Writing either MCP config file",
    "triggers a host-side reload and the write result reports the new connection status — rely on",
    "that signal rather than hunting for host source.",
    "",
  ].join("\n");
}

/** Write the same orientation content to `.webagent/workspace-map.md` for on-demand reads and the Files explorer. */
export async function writeWorkspaceMapFile(): Promise<void> {
  const abs = workspaceStatePath(WORKSPACE_MAP_REL);
  await ensureParentDir(abs);
  await fs.writeFile(abs, buildWorkspaceMapBlock(), "utf8");
}
