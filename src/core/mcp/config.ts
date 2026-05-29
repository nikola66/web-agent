import fs from "node:fs/promises";
import type { McpServerConfig, McpServersConfig } from "./types.js";

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

export function isServerEnabled(config: McpServerConfig): boolean {
  const enabled = config.enabled;
  if (enabled === false || String(enabled).toLowerCase() === "false") return false;
  return true;
}

export function interpolateEnvString(text: string, env: Record<string, string>): string {
  return String(text || "").replace(ENV_VAR_PATTERN, (_, name: string) => {
    const key = String(name || "").trim();
    return key && env[key] != null ? String(env[key]) : "";
  });
}

export function interpolateEnvRecord(
  record: Record<string, string> | undefined,
  env: Record<string, string>
): Record<string, string> | undefined {
  if (!record) return undefined;
  return Object.fromEntries(
    Object.entries(record).map(([k, v]) => [k, interpolateEnvString(String(v), env)])
  );
}

export function resolveServerConfig(config: McpServerConfig, env: Record<string, string>): McpServerConfig {
  const out: McpServerConfig = { ...config };
  if (out.env) {
    out.env = Object.fromEntries(
      Object.entries(out.env).map(([k, v]) => [k, interpolateEnvString(String(v), env)])
    );
  }
  if (out.headers) {
    out.headers = interpolateEnvRecord(out.headers, env);
  }
  return out;
}

export function listEnabledServers(
  servers: McpServersConfig,
  env: Record<string, string> = {}
): Array<[string, McpServerConfig]> {
  return Object.entries(servers || {})
    .filter(([, cfg]) => isServerEnabled(cfg))
    .map(([name, cfg]) => [name, resolveServerConfig(cfg, env)] as [string, McpServerConfig]);
}

export function shouldIncludeTool(
  toolName: string,
  toolsCfg: McpServerConfig["tools"]
): boolean {
  const cfg = toolsCfg || {};
  const include = Array.isArray(cfg.include) ? cfg.include : null;
  const exclude = Array.isArray(cfg.exclude) ? cfg.exclude : [];
  if (include?.length) return include.includes(toolName);
  if (exclude.includes(toolName)) return false;
  return true;
}

export function parseMcpServersConfig(raw: unknown): McpServersConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: McpServersConfig = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!name.trim() || !value || typeof value !== "object" || Array.isArray(value)) continue;
    out[name] = value as McpServerConfig;
  }
  return out;
}

export async function loadMcpServersConfigFromPath(configPath: string): Promise<McpServersConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return parseMcpServersConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveMcpServersConfigToPath(
  configPath: string,
  config: McpServersConfig
): Promise<void> {
  await fs.mkdir(configPath.replace(/\/[^/]+$/, ""), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
