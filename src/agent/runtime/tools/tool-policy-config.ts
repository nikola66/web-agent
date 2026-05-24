import fs from "node:fs/promises";
import { workspaceStatePath } from "../constants.js";

export const TOOL_POLICY_REL = ".webagent/tool-policy.json";

export type ToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
  auto?: Record<string, string>;
};

export const TOOL_GROUPS: Record<string, readonly string[]> = {
  core: [
    "read_file",
    "grep",
    "browse_workspace",
    "write_file",
    "edit_file",
    "multi_edit",
    "apply_patch",
    "run_python",
    "run_shell",
    "web_fetch",
    "web_post",
    "web_search",
    "skill_list",
    "skill_view",
    "todo_write",
    "system_info",
    "tool_search",
    "tool_activate",
  ],
  filesystem_mutate: ["make_dir", "delete_file", "move_file", "file_diff"],
  memory: ["memory_save", "memory_recall", "memory_search", "memory_forget"],
  session: ["session_memory_append", "session_memory_list", "session_search"],
  skills: ["skill_manage", "skill_bulk_save"],
  wiki: ["wiki_setup", "wiki_sync", "wiki_search"],
  composio: ["composio_connect", "composio_status", "composio_action"],
  cron: ["cron_register", "cron_list"],
  multimodal: ["vision_analyze", "audio_analyze", "youtube_transcribe", "image_info"],
  documents: ["pdf_extract", "docx_extract"],
  archives: ["extract_archive", "archive_list"],
  delivery: ["artifact_present", "email"],
};

export const DEFERRED_TOOL_GROUPS = new Set([
  "wiki",
  "cron",
  "multimodal",
  "documents",
  "archives",
  "delivery",
  "composio",
]);

export const DEFAULT_TOOL_POLICY: ToolPolicyConfig = {
  allow: [
    "group:core",
    "group:filesystem_mutate",
    "group:memory",
    "group:session",
    "group:skills",
  ],
  deny: [],
  auto: { composio: "when_configured" },
};

const GROUP_PREFIX = "group:";

let cachedPolicy: ToolPolicyConfig | null | undefined;

export function resetToolPolicyCacheForTest(): void {
  cachedPolicy = undefined;
}

function expandGroupEntry(entry: string): string[] {
  const raw = String(entry || "").trim();
  if (!raw) return [];
  if (!raw.startsWith(GROUP_PREFIX)) return [raw];
  const group = raw.slice(GROUP_PREFIX.length);
  return [...(TOOL_GROUPS[group] || [])];
}

function expandPolicyEntries(entries: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const entry of entries || []) {
    for (const name of expandGroupEntry(entry)) out.add(name);
  }
  return out;
}

export function isComposioConfigured(env: Record<string, string | undefined> = {}): boolean {
  return Boolean(String(env.WEBAGENT_COMPOSIO_API_KEY || "").trim());
}

function applyAutoRules(
  allowed: Set<string>,
  policy: ToolPolicyConfig,
  env: Record<string, string | undefined>
): Set<string> {
  const auto = policy.auto || {};
  if (auto.composio === "when_configured" && !isComposioConfigured(env)) {
    for (const name of TOOL_GROUPS.composio || []) allowed.delete(name);
  }
  return allowed;
}

export function resolvePolicyToolNames(
  allNames: string[],
  policy: ToolPolicyConfig | null | undefined,
  env: Record<string, string | undefined> = {}
): string[] {
  const all = new Set(allNames);
  const allowEntries = policy?.allow;
  let allowed: Set<string>;
  if (!allowEntries?.length) {
    allowed = new Set(allNames);
  } else {
    allowed = expandPolicyEntries(allowEntries);
    allowed = new Set([...allowed].filter((name) => all.has(name)));
  }
  const denied = expandPolicyEntries(policy?.deny);
  for (const name of denied) allowed.delete(name);
  allowed = applyAutoRules(allowed, policy || {}, env);
  return [...allowed].sort();
}

export function toolsInDeferredGroups(): Set<string> {
  const out = new Set<string>();
  for (const group of DEFERRED_TOOL_GROUPS) {
    for (const name of TOOL_GROUPS[group] || []) out.add(name);
  }
  return out;
}

export function resolveInitialActiveToolNames(
  policyNames: string[],
  allNames: string[],
  policy: ToolPolicyConfig | null | undefined,
  env: Record<string, string | undefined>,
  unlockedNames: Iterable<string> = []
): string[] {
  const deferred = toolsInDeferredGroups();
  const unlocked = new Set(unlockedNames);
  const active = new Set<string>();
  for (const name of policyNames) {
    if (!deferred.has(name) || unlocked.has(name)) active.add(name);
  }
  for (const name of unlocked) {
    if (canUnlockTool(name, allNames, policy, env)) active.add(name);
  }
  return [...active].sort();
}

export function isToolDeniedByPolicy(
  toolName: string,
  policy: ToolPolicyConfig | null | undefined
): boolean {
  const denied = expandPolicyEntries(policy?.deny);
  return denied.has(toolName);
}

export function canUnlockTool(
  toolName: string,
  allNames: string[],
  policy: ToolPolicyConfig | null | undefined,
  env: Record<string, string | undefined> = {}
): boolean {
  if (!allNames.includes(toolName)) return false;
  if (isToolDeniedByPolicy(toolName, policy)) return false;
  if (
    (TOOL_GROUPS.composio || []).includes(toolName) &&
    policy?.auto?.composio === "when_configured" &&
    !isComposioConfigured(env)
  ) {
    return false;
  }
  if (String(toolName).startsWith("mcp_")) return true;
  const deferred = toolsInDeferredGroups();
  if (deferred.has(toolName)) return true;
  return resolvePolicyToolNames(allNames, policy, env).includes(toolName);
}

export async function loadToolPolicy(): Promise<ToolPolicyConfig | null> {
  if (cachedPolicy !== undefined) return cachedPolicy;
  try {
    const raw = await fs.readFile(workspaceStatePath(TOOL_POLICY_REL), "utf8");
    cachedPolicy = JSON.parse(raw) as ToolPolicyConfig;
  } catch {
    cachedPolicy = null;
  }
  return cachedPolicy;
}

export async function ensureDefaultToolPolicy(): Promise<ToolPolicyConfig> {
  const existing = await loadToolPolicy();
  if (existing) return existing;
  const path = workspaceStatePath(TOOL_POLICY_REL);
  await fs.mkdir(workspaceStatePath(".webagent"), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(DEFAULT_TOOL_POLICY, null, 2)}\n`, "utf8");
  cachedPolicy = { ...DEFAULT_TOOL_POLICY };
  return cachedPolicy;
}

export function defaultToolPolicyJson(): string {
  return `${JSON.stringify(DEFAULT_TOOL_POLICY, null, 2)}\n`;
}
