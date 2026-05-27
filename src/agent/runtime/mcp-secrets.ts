import fs from "node:fs/promises";
import { MCP_SECRETS_REL, workspaceStatePath } from "./constants.js";

export type McpSecrets = {
  directus_token?: string;
  bearer_token?: string;
  updated_at?: string;
};

export function mcpSecretsPath(): string {
  return workspaceStatePath(MCP_SECRETS_REL);
}

export function parseMcpSecrets(raw: unknown): McpSecrets {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const out: McpSecrets = {};
  const directus = String(row.directus_token ?? "").trim();
  const bearer = String(row.bearer_token ?? "").trim();
  if (directus) out.directus_token = directus;
  if (bearer) out.bearer_token = bearer;
  const updated = String(row.updated_at ?? "").trim();
  if (updated) out.updated_at = updated;
  return out;
}

export async function loadMcpSecrets(): Promise<McpSecrets> {
  try {
    const raw = await fs.readFile(mcpSecretsPath(), "utf8");
    return parseMcpSecrets(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function saveMcpSecrets(secrets: McpSecrets): Promise<void> {
  const path = mcpSecretsPath();
  await fs.mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  const payload: McpSecrets = {
    ...(secrets.directus_token ? { directus_token: secrets.directus_token } : {}),
    ...(secrets.bearer_token ? { bearer_token: secrets.bearer_token } : {}),
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function clearMcpSecrets(): Promise<void> {
  try {
    await fs.unlink(mcpSecretsPath());
  } catch {
    /* ignore */
  }
}

export function resolveMcpBearerToken(secrets: McpSecrets): string {
  return String(secrets.directus_token || secrets.bearer_token || "").trim();
}

export function mcpSecretsToEnv(secrets: McpSecrets): Record<string, string> {
  const token = resolveMcpBearerToken(secrets);
  if (!token) return {};
  return {
    DIRECTUS_TOKEN: token,
    DIRECTUS_API_TOKEN: token,
    DIRECTUS_ACCESS_TOKEN: token,
    MCP_BEARER_TOKEN: token,
  };
}

export function maskMcpToken(token: string): string {
  const t = String(token || "").trim();
  if (!t) return "(not set)";
  if (t.length <= 8) return "••••••••";
  return `${t.slice(0, 4)}…${t.slice(-4)} (${t.length} chars)`;
}

export function defaultMcpAuthHeaderTemplate(): Record<string, string> {
  return { Authorization: "Bearer ${DIRECTUS_TOKEN}" };
}
