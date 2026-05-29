/**
 * Runtime filesystem orientation for the agent.
 *
 * `buildWorkspaceMapBlock()` is appended to the system prompt every turn; the same
 * content is written to `.webagent/workspace-map.md` for read_file / Files explorer.
 */

import fs from "node:fs/promises";
import {
  WORKSPACE_MAP_REL,
  WS,
  getMemoryRoot,
  getWorkspaceRoot,
  workspaceStatePath,
} from "./constants.js";
import {
  WORKSPACE_BUNDLED_SKILLS_REL,
  WORKSPACE_KNOWLEDGE_VAULT_DIR_REL,
  WORKSPACE_PLANS_DIR_REL,
  WORKSPACE_PROJECTS_DIR_REL,
  WORKSPACE_TELEGRAM_INBOX_REL,
  WORKSPACE_WORK_DIR_REL,
  workspaceBootstrapDirRels,
} from "./workspace-layout.js";
import { ensureParentDir, resolveWorkspacePath } from "./workspace-paths.js";
import { createToolContext } from "./tools/context.js";

export function buildWorkspaceMapBlock(): string {
  const root = getWorkspaceRoot();
  const memory = getMemoryRoot();
  return [
    "# Workspace & filesystem (injected every turn)",
    "",
    `Sandbox root: \`${root}\` (display label \`/workspace\`). All file tools resolve paths here.`,
    "Use workspace-relative paths only — never `/home/...`, never host repo paths like `src/agent/...`.",
    "",
    "## Directory map (where things belong)",
    "```",
    ".                          # workspace root — identity files only; NOT deliverables",
    "├── AGENT.md USER.md SOUL.md HEARTBEAT.md",
    `├── ${WORKSPACE_PLANS_DIR_REL}/                 # saved /plan markdown`,
    `├── ${WORKSPACE_PROJECTS_DIR_REL}/<slug>/        # durable user deliverables (apps, demos, client work)`,
    `├── ${WORKSPACE_WORK_DIR_REL}/<slug>/            # scratch / spikes / one-off exports`,
    "├── memory/                  # agent persistence (sql.js + JSON artifacts)",
    "│   ├── conversations/       # archived chats (session_search)",
    "│   ├── runs/                # turn logs — tool names/errors ONLY; never grep for API bodies",
    "│   ├── reflections/ learnings (via sqlite)",
    "│   ├── snapshots/           # oversized tool-result spill — use list_digest, not scavenger reads",
    "│   ├── jobs/ channels/",
    "│   └── memory.sqlite",
    "└── .webagent/",
    `    ├── skills/<category>/<slug>/SKILL.md   # USER + imported skills (skill list/manage/import_dir)`,
    `    ├── ${WORKSPACE_BUNDLED_SKILLS_REL}/<slug>/   # BUNDLED seed — read-only; re-copied each launch`,
    "    │   └── (do NOT install or copy user skills here)",
    `    ├── ${WORKSPACE_TELEGRAM_INBOX_REL}/   # Telegram/channel uploads; archives land here`,
    "    │   └── extract with extract_archive / archive_list (no path = newest inbox zip)",
    `    ├── ${WORKSPACE_KNOWLEDGE_VAULT_DIR_REL}/  # wiki / knowledge base files`,
    "    ├── checkpoints/         # /checkpoint rollback snapshots",
    "    ├── capabilities/      # capability tool handlers (system-seeded)",
    "    ├── session-memory.jsonl history.json todos.json cronjobs.json …",
    "    ├── mcp-servers.json mcp-secrets.json tool-policy.json",
    "    └── workspace-map.md     # this map (also in system prompt)",
    "```",
    "",
    "## Skills (common confusion)",
    `- **Install / import / edit procedures:** \`.webagent/skills/<category>/<slug>/\` (e.g. \`.webagent/skills/local/my-skill/SKILL.md\`).`,
    `- **After \`extract_archive\`:** find the folder that contains \`SKILL.md\`, then \`skill\` action=manage manage_action=import_dir path=<that-folder> — do not hand-copy to capabilities.`,
    `- **Bundled built-ins:** \`${WORKSPACE_BUNDLED_SKILLS_REL}/\` is seeded from the app each launch — \`skill\` action=list already includes them; never move user skills here.`,
    "- Repo contributor path `src/capabilities/skills/` is **outside** this sandbox (host source only).",
    "",
    "## Tool path & argument contract",
    "| Tool | Required path keys | Notes |",
    "|------|-------------------|-------|",
    "| read_file, write_file, edit_file, list_dir, tree | `path` | Aliases: `file`, `filename`, `file_path` |",
    "| write_file | `path` + `content` (both strings) | Large JSON/text: pass full `content`; if encoding fails use `skill` manage or `run_python` copy |",
    "| grep | `pattern`; optional `root` (dir or file) | Not `query` |",
    "| browse_workspace | `action` + `path` | `list` \\| `tree` \\| `find` |",
    "| session_search | `query` | Not `pattern` |",
    "| skill view/manage | `name` (slug) | Not `slug` key alone |",
    "| extract_archive | `archive_path` (or omit for newest inbox zip) | Then import_dir on extracted SKILL.md folder |",
    "| make_dir | `path` | Prefer `projects/<slug>/` or `work/<slug>/` before writes |",
    "",
    "First orientation step when unsure: `browse_workspace({\"action\":\"tree\",\"path\":\".\"})` or `list_dir({\"path\":\".webagent\"})`.",
    "",
    "## Persisted vs ephemeral",
    "Persisted (safe to read/edit): `.webagent/skills/`, `.webagent/knowledge-vault/`, `.webagent/checkpoints/`,",
    "`.webagent/mcp-*.json`, `.webagent/tool-policy.json`, `.webagent/history.json`, `.webagent/session-memory.jsonl`,",
    "`plans/`, `projects/`, `work/`,",
    `\`${memory}/\` (except treat \`memory/runs/\` and \`memory/snapshots/\` as internal — see memory-layers skill).`,
    "",
    "Ephemeral (re-seeded each launch — do not hand-edit): `.webagent/tools.json`, `.webagent/providers.json`,",
    "`.webagent/browseragent.json`, `.webagent/channels.json`, `.webagent/tools-capability-index.md`,",
    "`.webagent/workspace-map.md`, `.webagent/capabilities/` tree, `agent.js`.",
    "",
    "## Sandbox boundary",
    "Host app source (adapter, MCP host, UI) is NOT in this workspace — grep for `McpHost` or IPC symbols returns nothing.",
    "Debug MCP via `.webagent/mcp-servers.json` + MCP tools + `web_post`, not by searching for host code.",
    "",
  ].join("\n");
}

/** Create standard workspace folders on boot (idempotent). */
export async function ensureWorkspaceLayoutDirs(cwd = WS): Promise<void> {
  const ctx = createToolContext({ cwd, runId: "bootstrap" });
  for (const rel of workspaceBootstrapDirRels()) {
    const abs = resolveWorkspacePath(ctx, rel);
    await fs.mkdir(abs, { recursive: true });
  }
}

/** Write orientation map to `.webagent/workspace-map.md`. */
export async function writeWorkspaceMapFile(): Promise<void> {
  await ensureWorkspaceLayoutDirs().catch(() => {});
  const abs = workspaceStatePath(WORKSPACE_MAP_REL);
  await ensureParentDir(abs);
  await fs.writeFile(abs, buildWorkspaceMapBlock(), "utf8");
}
