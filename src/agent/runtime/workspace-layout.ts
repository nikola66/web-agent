/**
 * Canonical workspace-relative paths for the Nodebox profile cwd.
 * Mirror of `src/core/workspace-layout.ts` — keep in sync (see tests/workspace-layout-parity.test.ts).
 */

export const WORKSPACE_PROJECTS_DIR_REL = "projects";
export const WORKSPACE_WORK_DIR_REL = "work";
export const WORKSPACE_TELEGRAM_INBOX_REL = ".webagent/telegram-inbox";
export const WORKSPACE_BUNDLED_SKILLS_REL = ".webagent/capabilities/skills";

/** Subdirectory names directly under `.webagent/` (not including the `.webagent` prefix). */
export const WORKSPACE_WEBAGENT_USER_SUBDIRS = [
  "knowledge-vault",
  "skills",
  "checkpoints",
  "capabilities",
  "telegram-inbox",
] as const;

export const WORKSPACE_PLANS_DIR_REL = "plans";
export const WORKSPACE_KNOWLEDGE_VAULT_DIR_REL = ".webagent/knowledge-vault";

export const WORKSPACE_SESSION_MEMORY_REL = ".webagent/session-memory.jsonl";
export const WORKSPACE_TELEGRAM_AUTH_REL = ".webagent/telegram-auth.json";
export const WORKSPACE_HISTORY_REL = ".webagent/history.json";
export const WORKSPACE_TODOS_REL = ".webagent/todos.json";
export const WORKSPACE_CRONJOBS_REL = ".webagent/cronjobs.json";
export const WORKSPACE_HEARTBEAT_STATE_REL = ".webagent/heartbeat-state.json";
export const WORKSPACE_CHANNEL_STATE_REL = ".webagent/channel-state.json";
export const WORKSPACE_MIGRATIONS_REL = ".webagent/migrations.json";
export const WORKSPACE_COMPOSIO_AUDIT_REL = ".webagent/composio-actions.jsonl";
export const WORKSPACE_MCP_SERVERS_REL = ".webagent/mcp-servers.json";
export const WORKSPACE_MCP_SECRETS_REL = ".webagent/mcp-secrets.json";
export const WORKSPACE_TOOL_POLICY_REL = ".webagent/tool-policy.json";

export const WORKSPACE_MEMORY_SUBDIRS = [
  "conversations",
  "runs",
  "reflections",
  "snapshots",
  "jobs",
  "channels",
] as const;

/** Dotfiles / single files under `.webagent/` that must survive OPFS snapshot export. */
export const WORKSPACE_WEBAGENT_USER_FILES = [
  WORKSPACE_SESSION_MEMORY_REL,
  WORKSPACE_TELEGRAM_AUTH_REL,
  WORKSPACE_HISTORY_REL,
  WORKSPACE_TODOS_REL,
  WORKSPACE_CRONJOBS_REL,
  WORKSPACE_HEARTBEAT_STATE_REL,
  WORKSPACE_CHANNEL_STATE_REL,
  WORKSPACE_MIGRATIONS_REL,
  WORKSPACE_COMPOSIO_AUDIT_REL,
  WORKSPACE_MCP_SERVERS_REL,
  WORKSPACE_MCP_SECRETS_REL,
  WORKSPACE_TOOL_POLICY_REL,
] as const;

/** Default dirs to show in the Files tree even when empty. */
export const WORKSPACE_EMPTY_DIR_INJECTION: readonly string[] = [
  WORKSPACE_PLANS_DIR_REL,
  WORKSPACE_KNOWLEDGE_VAULT_DIR_REL,
  WORKSPACE_PROJECTS_DIR_REL,
  WORKSPACE_WORK_DIR_REL,
  WORKSPACE_TELEGRAM_INBOX_REL,
];

/** Workspace-relative directories created on first boot (runtime + host). */
export function workspaceBootstrapDirRels(): string[] {
  const dirs = [
    WORKSPACE_PLANS_DIR_REL,
    WORKSPACE_PROJECTS_DIR_REL,
    WORKSPACE_WORK_DIR_REL,
    ".webagent",
    ...WORKSPACE_WEBAGENT_USER_SUBDIRS.map((sub) => `.webagent/${sub}`),
    "memory",
    ...WORKSPACE_MEMORY_SUBDIRS.map((sub) => `memory/${sub}`),
  ];
  return [...new Set(dirs)];
}
