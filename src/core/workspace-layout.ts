/**
 * Canonical workspace-relative paths for the Nodebox profile cwd
 * (`/workspace/{profileId}` in-browser). Kept in one place so OPFS sync,
 * live listing, and the Files explorer stay aligned with agent runtime tools.
 */

/** Subdirectory names directly under `.webagent/` (not including the `.webagent` prefix). */
export const WORKSPACE_WEBAGENT_USER_SUBDIRS = [
  "plans",
  "knowledge-vault",
  "skills",
  "checkpoints",
  "capabilities",
] as const;

export const WORKSPACE_PLANS_DIR_REL = ".webagent/plans";
export const WORKSPACE_KNOWLEDGE_VAULT_DIR_REL = ".webagent/knowledge-vault";

export const WORKSPACE_SESSION_MEMORY_REL = ".webagent/session-memory.jsonl";
export const WORKSPACE_TELEGRAM_AUTH_REL = ".webagent/telegram-auth.json";

/** Dotfiles / single files under `.webagent/` that must survive OPFS snapshot export. */
export const WORKSPACE_WEBAGENT_USER_FILES = [
  WORKSPACE_SESSION_MEMORY_REL,
  WORKSPACE_TELEGRAM_AUTH_REL,
] as const;

/** Default dirs to show in the Files tree even when empty (matches primary user-facing vaults). */
export const WORKSPACE_EMPTY_DIR_INJECTION: readonly string[] = [
  WORKSPACE_PLANS_DIR_REL,
  WORKSPACE_KNOWLEDGE_VAULT_DIR_REL,
];
