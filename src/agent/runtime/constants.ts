import nodePath from "node:path";

let WS_VALUE = "/workspace";
let ROOT_VALUE = "/workspace";

if (typeof process !== "undefined" && process.cwd) {
  WS_VALUE = process.cwd();
  // Use process.cwd() as ROOT; path.resolve() not available at module init time
  ROOT_VALUE = WS_VALUE;
}

export const WS = WS_VALUE;
export const WORKSPACE_LABEL = "/workspace";
/**
 * Canonical writable workspace root for all runtime file operations.
 * We intentionally anchor to process cwd to avoid host-level `/workspace`
 * aliases that may exist but are not writable in local runs.
 */
export const ROOT = ROOT_VALUE;

function envPathOverride(name: string): string {
  return typeof process !== "undefined" ? String(process.env?.[name] || "").trim() : "";
}

export function isNodeboxRuntime(): boolean {
  return String(process.env.WEBAGENT_RUNTIME ?? "").trim() === "nodebox";
}

/** Resolve any root override to an absolute path so host/sandbox/module-init all agree. Relative overrides are anchored to cwd (`WS`). */
function toAbsoluteRoot(value: string): string {
  const s = String(value || "").trim();
  if (!s) return WS;
  return nodePath.isAbsolute(s) ? s : nodePath.resolve(WS, s);
}

export function getWorkspaceRoot(): string {
  return toAbsoluteRoot(envPathOverride("WEBAGENT_WORKSPACE_ROOT") || WS);
}

export function getRuntimeRoot(): string {
  return toAbsoluteRoot(envPathOverride("WEBAGENT_RUNTIME_ROOT") || getWorkspaceRoot());
}

export function workspaceStatePath(relativePath: string): string {
  return `${getWorkspaceRoot()}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

export function getMemoryRoot(): string {
  return toAbsoluteRoot(envPathOverride("WEBAGENT_MEMORY_ROOT") || `${getRuntimeRoot()}/memory`);
}

export function memoryStatePath(relativePath: string): string {
  return `${getMemoryRoot()}/${String(relativePath || "").replace(/^\/+/, "")}`;
}

export const HISTORY_PATH = `${WS}/.webagent/history.json`;
export const AGENT_MD = `${WS}/AGENT.md`;
export const USER_MD = `${WS}/USER.md`;
export const HEARTBEAT_MD = `${WS}/HEARTBEAT.md`;
export const SOUL_MD = `${WS}/SOUL.md`;
export const TOOL_CATALOG_PATH = `${WS}/.webagent/tools.json`;
export const PROVIDER_CATALOG_PATH = `${WS}/.webagent/providers.json`;
export const BROWSER_AGENT_CATALOG_PATH = `${WS}/.webagent/browseragent.json`;
export const CHANNEL_CATALOG_PATH = `${WS}/.webagent/channels.json`;
export const CAPABILITIES_DIR = `${WS}/.webagent/capabilities`;
export const CHANNEL_STATE_PATH = `${WS}/.webagent/channel-state.json`;
export const CRONJOBS_PATH = `${WS}/.webagent/cronjobs.json`;
export const HEARTBEAT_STATE_PATH = `${WS}/.webagent/heartbeat-state.json`;
export const MEMORY_ROOT = getMemoryRoot();
export const CHANNEL_HISTORY_DIR = `${MEMORY_ROOT}/channels`;
export const MEMORY_CONVERSATIONS_DIR = `${MEMORY_ROOT}/conversations`;
export const MEMORY_RUNS_DIR = `${MEMORY_ROOT}/runs`;
export const MEMORY_REFLECTIONS_DIR = `${MEMORY_ROOT}/reflections`;
export const MEMORY_SNAPSHOTS_DIR = `${MEMORY_ROOT}/snapshots`;
export const MEMORY_JOBS_DIR = `${MEMORY_ROOT}/jobs`;
export const MEMORY_DB_PATH = `${MEMORY_ROOT}/memory.sqlite`;
/** Append-only session notes for this workspace (MVP “task memory lite”). Path must match `WORKSPACE_SESSION_MEMORY_REL` in `src/core/workspace-layout.ts`. */
export const SESSION_MEMORY_PATH = `${WS}/.webagent/session-memory.jsonl`;
/** First-Telegram-user lock state (`workspaceStatePath(TELEGRAM_AUTH_REL)`). Must match `WORKSPACE_TELEGRAM_AUTH_REL` in `src/core/workspace-layout.ts`. */
export const TELEGRAM_AUTH_REL = ".webagent/telegram-auth.json";
/** Append-only Composio external-action audit log. Must match `WORKSPACE_COMPOSIO_AUDIT_REL` in `src/core/workspace-layout.ts`. */
export const COMPOSIO_AUDIT_REL = ".webagent/composio-actions.jsonl";
/** MCP server definitions. Must match `WORKSPACE_MCP_SERVERS_REL` in `src/core/workspace-layout.ts`. */
export const MCP_SERVERS_REL = ".webagent/mcp-servers.json";
/** MCP bearer tokens for `${DIRECTUS_TOKEN}` header interpolation. */
export const MCP_SECRETS_REL = ".webagent/mcp-secrets.json";
/** Tool allow/deny policy. Must match `WORKSPACE_TOOL_POLICY_REL` in `src/core/workspace-layout.ts`. */
export const TOOL_POLICY_REL = ".webagent/tool-policy.json";
/** Auto-generated brief index of all policy-allowed tools (system prompt + human reference). */
export const TOOLS_CAPABILITY_INDEX_REL = ".webagent/tools-capability-index.md";
/** Auto-generated runtime filesystem orientation map (re-seeded each launch; system prompt + read_file reference). */
export const WORKSPACE_MAP_REL = ".webagent/workspace-map.md";
/** Skill documents — reusable procedure markdown files injected into system prompt. */
export const SKILLS_DIR = `${WS}/.webagent/skills`;
/** Conversation history checkpoints for rollback. */
export const CHECKPOINTS_DIR = `${WS}/.webagent/checkpoints`;
/** Saved markdown plans from `/plan` (workspace-relative). Must match `WORKSPACE_PLANS_DIR_REL` in `src/core/workspace-layout.ts`. */
export const PLANS_DIR_REL = "plans";
export const PLANS_DIR = `${WS}/${PLANS_DIR_REL}`;
/** Auto-trim history when message count exceeds this threshold. */
export const CONTEXT_UPDATE_START = "<<<WEBAGENT_CONTEXT_UPDATE>>>";
export const CONTEXT_UPDATE_END = "<<<END_WEBAGENT_CONTEXT_UPDATE>>>";
export const USER_UPDATE_START = "<<<WEBAGENT_USER_UPDATE>>>";
export const USER_UPDATE_END = "<<<END_WEBAGENT_USER_UPDATE>>>";
export const PROFILE_UPDATE_START = "<<<WEBAGENT_PROFILE_UPDATE>>>";
export const PROFILE_UPDATE_END = "<<<END_WEBAGENT_PROFILE_UPDATE>>>";

export const TOOL_CONFIRM_START = "<<<WEBAGENT_TOOL_CONFIRM>>>";
export const TOOL_CONFIRM_END = "<<<END_WEBAGENT_TOOL_CONFIRM>>>";
export const ARTIFACT_PRESENT_START = "<<<WEBAGENT_ARTIFACT>>>";
export const ARTIFACT_PRESENT_END = "<<<END_WEBAGENT_ARTIFACT>>>";
export const SELF_IMPROVEMENT_START = "<<<WEBAGENT_SELF_IMPROVEMENT>>>";
export const SELF_IMPROVEMENT_END = "<<<END_WEBAGENT_SELF_IMPROVEMENT>>>";

/** Minimum wall-clock spacing between heartbeat "ticks" that evaluate `.webagent/cronjobs.json`. */
export const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
export const LLM_REQUEST_TIMEOUT_MS = 180_000;
export const LLM_METADATA_TIMEOUT_MS = 15_000;
export const OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW = 64_000;

export const TOOL_START_MARKER = "<<<TOOL>>>";
export const TOOL_END_MARKER = "<<<END>>>";
export const CLARIFY_PROMPT_START = "<<<CLARIFY>>>";
export const TOOLCALL_XML_START_MARKER = "<TOOLCALL>";
export const TOOLCALL_XML_END_MARKER = "</TOOLCALL>";
export const LONGCAT_TOOLCALL_START_MARKER = "<longcat_tool_call>";
export const LONGCAT_TOOLCALL_END_MARKER = "</longcat_tool_call>";
export const HIDDEN_STREAM_MARKERS = [
  { start: TOOL_START_MARKER, end: TOOL_END_MARKER },
  { start: CLARIFY_PROMPT_START, end: TOOL_END_MARKER },
  { start: TOOLCALL_XML_START_MARKER, end: TOOLCALL_XML_END_MARKER },
  { start: LONGCAT_TOOLCALL_START_MARKER, end: LONGCAT_TOOLCALL_END_MARKER },
];
