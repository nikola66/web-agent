import fs from "node:fs/promises";
import { MCP_SERVERS_REL, workspaceStatePath } from "./constants.js";
import { loadMcpSecrets, mcpSecretsToEnv } from "./mcp-secrets.js";

export type McpToolsFilter = {
  include?: string[];
  exclude?: string[];
  resources?: boolean;
  prompts?: boolean;
};

export type McpServerConfig = {
  command?: string;
  args?: string[];
  url?: string;
  transport?: "sse" | "streamable-http";
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
  connect_timeout?: number;
  tools?: McpToolsFilter;
};

export type McpServersConfig = Record<string, McpServerConfig>;

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

function interpolateEnvString(text: string, env: Record<string, string>): string {
  return String(text || "").replace(ENV_VAR_PATTERN, (_, name: string) => {
    const key = String(name || "").trim();
    return key && env[key] != null ? String(env[key]) : "";
  });
}

export function mcpConfigPath(): string {
  return workspaceStatePath(MCP_SERVERS_REL);
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

export async function loadMcpServersConfig(): Promise<McpServersConfig> {
  try {
    const raw = await fs.readFile(mcpConfigPath(), "utf8");
    return parseMcpServersConfig(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveMcpServersConfig(config: McpServersConfig): Promise<void> {
  const path = mcpConfigPath();
  await fs.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function collectEnvVarRefs(config: McpServersConfig): Set<string> {
  const keys = new Set<string>();
  const scan = (text: string) => {
    for (const m of String(text || "").matchAll(ENV_VAR_PATTERN)) {
      const key = String(m[1] || "").trim();
      if (key) keys.add(key);
    }
  };
  for (const srv of Object.values(config)) {
    for (const v of Object.values(srv.env || {})) scan(String(v));
    for (const v of Object.values(srv.headers || {})) scan(String(v));
  }
  return keys;
}

export function mergeMcpEnv(
  config: McpServersConfig,
  baseEnv: Record<string, string> = typeof process !== "undefined" && process.env
    ? (process.env as Record<string, string>)
    : {}
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of collectEnvVarRefs(config)) {
    if (baseEnv[key] != null) out[key] = String(baseEnv[key]);
  }
  for (const [key, value] of Object.entries(baseEnv)) {
    if (key.startsWith("MCP_") && value != null) out[key] = String(value);
  }
  const directusKeys = ["DIRECTUS_TOKEN", "DIRECTUS_API_TOKEN", "DIRECTUS_ACCESS_TOKEN"] as const;
  for (const key of directusKeys) {
    if (baseEnv[key] != null && baseEnv[key] !== "") out[key] = String(baseEnv[key]);
  }
  return out;
}

export function mcpEnvForConfig(config: McpServersConfig): Record<string, string> {
  const full =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string>)
      : {};
  return mergeMcpEnv(config, full);
}

/** Async env merge including workspace `.webagent/mcp-secrets.json`. */
export async function mcpEnvForConfigResolved(config: McpServersConfig): Promise<Record<string, string>> {
  const secrets = await loadMcpSecrets();
  const fromSecrets = mcpSecretsToEnv(secrets);
  const full =
    typeof process !== "undefined" && process.env
      ? { ...(process.env as Record<string, string>), ...fromSecrets }
      : { ...fromSecrets };
  return mergeMcpEnv(config, full);
}

export function mcpAuthEnvWarnings(
  config: McpServersConfig,
  env: Record<string, string>
): string[] {
  const warnings: string[] = [];
  for (const [name, srv] of Object.entries(config || {})) {
    for (const [header, template] of Object.entries(srv.headers || {})) {
      if (!/authorization/i.test(header)) continue;
      const resolved = interpolateEnvString(String(template), env).trim();
      if (!resolved || /^Bearer\s*$/i.test(resolved)) {
        warnings.push(
          `server '${name}' has empty Authorization — set directus_token in .webagent/mcp-secrets.json (or the referenced env var)`
        );
      }
    }
  }
  return warnings;
}

export async function upsertMcpServer(name: string, serverConfig: McpServerConfig): Promise<void> {
  const config = await loadMcpServersConfig();
  config[name] = serverConfig;
  await saveMcpServersConfig(config);
}

export async function removeMcpServer(name: string): Promise<boolean> {
  const config = await loadMcpServersConfig();
  if (!(name in config)) return false;
  delete config[name];
  if (!Object.keys(config).length) {
    await saveMcpServersConfig({});
  } else {
    await saveMcpServersConfig(config);
  }
  return true;
}
