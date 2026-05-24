import fs from "node:fs/promises";
import { MCP_SERVERS_REL, workspaceStatePath } from "./constants.js";

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

export function mcpEnvForConfig(config: McpServersConfig): Record<string, string> {
  if (typeof process === "undefined" || !process.env) return {};
  const full = process.env;
  const out: Record<string, string> = {};
  for (const key of collectEnvVarRefs(config)) {
    if (full[key] != null) out[key] = String(full[key]);
  }
  for (const [key, value] of Object.entries(full)) {
    if (key.startsWith("MCP_") && value != null) out[key] = String(value);
  }
  return out;
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
