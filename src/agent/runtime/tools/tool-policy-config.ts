import fs from "node:fs/promises";
import { workspaceStatePath } from "../constants.js";
import type { ToolVisibility } from "./definition.js";
import { isDeferredOrHiddenVisibility, resolveToolVisibility, type ToolVisibilityMeta } from "./tool-visibility.js";
import { DEFERRED_TOOL_GROUPS, TOOL_GROUPS } from "./tool-groups.js";

export { DEFERRED_TOOL_GROUPS, TOOL_GROUPS } from "./tool-groups.js";

export const TOOL_POLICY_REL = ".webagent/tool-policy.json";

export type ToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
  auto?: Record<string, string>;
};

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

export function resolveInitialActiveToolNames(
  policyNames: string[],
  catalog: Record<string, ToolVisibilityMeta | undefined>,
  allNames: string[],
  policy: ToolPolicyConfig | null | undefined,
  env: Record<string, string | undefined>,
  unlockedNames: Iterable<string> = []
): string[] {
  const unlocked = new Set(unlockedNames);
  const active = new Set<string>();
  for (const name of policyNames) {
    const visibility = resolveToolVisibility(name, catalog[name]);
    if (visibility === "active" || unlocked.has(name)) active.add(name);
  }
  for (const name of unlocked) {
    if (canUnlockTool(name, catalog, allNames, policy, env)) active.add(name);
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
  catalog: Record<string, ToolVisibilityMeta | undefined>,
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
  const visibility = resolveToolVisibility(toolName, catalog[toolName]);
  if (isDeferredOrHiddenVisibility(visibility)) return true;
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
