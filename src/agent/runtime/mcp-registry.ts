import { ipcMcpRequest } from "./ipc.js";
import { MCP_SECRETS_REL, MCP_SERVERS_REL } from "./constants.js";
import {
  loadMcpServersConfig,
  mcpAuthEnvWarnings,
  mcpEnvForConfigResolved,
  type McpServersConfig,
} from "./mcp-config.js";

export type McpDiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
  mcpToolName: string;
};

export type McpHostStatus = {
  servers: Array<{ name: string; connected: boolean; toolCount: number; error?: string }>;
  toolCount: number;
  failed: number;
};

type McpToolEntry = {
  fn: (args: Record<string, unknown>) => Promise<string>;
  emoji: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

let mcpToolsCache: Record<string, McpToolEntry> | null = null;

export function formatMcpIpcError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "unknown error");
  if (/IPC MCP request timed out/i.test(msg)) {
    return `${msg} Keep the Web Agent browser tab open — MCP connections run in the page adapter.`;
  }
  if (/failed to fetch|network|CORS/i.test(msg)) {
    return `${msg} Cross-origin MCP needs the browser tab open (requests route via /api/proxy).`;
  }
  return msg;
}

async function mcpIpc(
  payload: Record<string, unknown>,
  config?: McpServersConfig,
  timeoutMs = 180_000
) {
  const servers = config ?? (await loadMcpServersConfig());
  try {
    const env = await mcpEnvForConfigResolved(servers);
    return await ipcMcpRequest({ ...payload, config: servers, env }, timeoutMs);
  } catch (err) {
    throw new Error(formatMcpIpcError(err));
  }
}

export async function mcpDiscover(): Promise<{ tools: McpDiscoveredTool[]; status?: McpHostStatus }> {
  const config = await loadMcpServersConfig();
  const resp = (await mcpIpc({ action: "discover" }, config)) as {
    ok?: boolean;
    tools?: McpDiscoveredTool[];
    status?: McpHostStatus;
    error?: string;
  };
  if (resp?.ok === false) throw new Error(String(resp.error || "MCP discover failed"));
  return {
    tools: Array.isArray(resp?.tools) ? resp.tools : [],
    status: resp.status,
  };
}

export async function mcpReload() {
  return mcpIpc({ action: "reload" });
}

async function mcpCallTool(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  timeoutMs?: number
) {
  const resp = (await mcpIpc(
    { action: "call", server, tool, args, timeout_ms: timeoutMs },
    undefined,
    timeoutMs ? timeoutMs + 15_000 : 180_000
  )) as { ok?: boolean; result?: unknown; error?: string };
  if (resp?.ok === false) throw new Error(String(resp.error || "MCP tool call failed"));
  return resp?.result;
}

export async function mcpProbeServer(name: string, serverConfig?: Record<string, unknown>) {
  const config = await loadMcpServersConfig();
  return mcpIpc({
    action: "probe",
    name,
    ...(serverConfig ? { server_config: serverConfig } : {}),
  }, config);
}

export async function mcpShutdown() {
  return mcpIpc({ action: "shutdown" }, {}, 30_000);
}

function formatMcpToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result ?? null);
  } catch {
    return String(result ?? "");
  }
}

function buildHandler(tool: McpDiscoveredTool) {
  return async (args: Record<string, unknown>) => {
    const result = await mcpCallTool(tool.server, tool.mcpToolName, args || {});
    return JSON.stringify({ result: formatMcpToolResult(result) });
  };
}

export async function discoverAndRegisterMcpTools(): Promise<{
  tools: McpDiscoveredTool[];
  status?: McpHostStatus;
}> {
  const { tools, status } = await mcpDiscover();
  const nextTools: Record<string, McpToolEntry> = {};
  for (const tool of tools) {
    nextTools[tool.name] = {
      fn: buildHandler(tool),
      emoji: "🔌",
      description: `[MCP:${tool.server}] ${tool.description}`,
      inputSchema: tool.inputSchema,
    };
  }
  mcpToolsCache = nextTools;
  void import("./tools/registry.js").then((m) => m.bustToolsCacheForMcp?.());
  return { tools, status };
}

export function getMcpToolsCache(): Record<string, McpToolEntry> {
  return mcpToolsCache || {};
}

export function getMcpCatalogCache(): Record<string, Omit<McpToolEntry, "fn">> {
  return Object.fromEntries(
    Object.entries(getMcpToolsCache()).map(([name, entry]) => [
      name,
      { emoji: entry.emoji, description: entry.description, inputSchema: entry.inputSchema },
    ])
  );
}

export function clearMcpToolsCache() {
  mcpToolsCache = null;
}

export function formatMcpStartupBanner(tools: McpDiscoveredTool[], failed = 0): string {
  const serverCount = new Set(tools.map((t) => t.server)).size;
  return `MCP: ${tools.length} tool(s) from ${serverCount} server(s)${failed ? ` (${failed} failed)` : ""}`;
}

/**
 * Banner plus the per-server failure reasons. The plain count ("1 failed")
 * leaves the agent blind to *why* a server did not connect; surface the
 * sanitized connect error and an auth hint so the next step is obvious.
 */
export function describeMcpReload(
  tools: McpDiscoveredTool[],
  status: McpHostStatus | undefined,
  authHint?: string
): string {
  const failed = status?.failed ?? 0;
  let banner = formatMcpStartupBanner(tools, failed);
  if (failed && status) {
    const details = status.servers
      .filter((s) => !s.connected)
      .map((s) => `${s.name}: ${s.error || "connection failed"}`)
      .join("; ");
    if (details) banner += ` — ${details}`;
  }
  if (!tools.length && failed && authHint) banner += ` (${authHint})`;
  return banner;
}

export async function maybeReloadMcpAfterConfigWrite(relPath: string): Promise<string | null> {
  const norm = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm !== MCP_SERVERS_REL && norm !== MCP_SECRETS_REL) return null;
  try {
    const config = await loadMcpServersConfig();
    const env = await mcpEnvForConfigResolved(config);
    const { tools, status } = await discoverAndRegisterMcpTools();
    void import("./turn.js").then((m) => m.invalidateToolNamesCache?.());
    return describeMcpReload(tools, status, mcpAuthEnvWarnings(config, env)[0]);
  } catch (err) {
    return `MCP reload failed (${err instanceof Error ? err.message : String(err)})`;
  }
}

/** Discover MCP servers from `.webagent/mcp-servers.json` at agent startup. */
export async function discoverMcpOnStartup(): Promise<void> {
  const config = await loadMcpServersConfig();
  if (!Object.keys(config).length) return;
  try {
    const { dim } = await import("./terminal-format.js");
    const env = await mcpEnvForConfigResolved(config);
    for (const warning of mcpAuthEnvWarnings(config, env)) {
      console.log(dim(`MCP: ${warning}`));
    }
    const { tools, status } = await discoverAndRegisterMcpTools();
    console.log(dim(describeMcpReload(tools, status, mcpAuthEnvWarnings(config, env)[0])));
    void import("./turn.js").then((m) => m.invalidateToolNamesCache?.());
  } catch (err) {
    const { dim } = await import("./terminal-format.js");
    console.log(
      dim(`MCP: startup discover failed (${err instanceof Error ? err.message : String(err)})`)
    );
  }
}

export async function shutdownMcpOnExit(): Promise<void> {
  try {
    await mcpShutdown();
  } catch {
    /* ignore */
  }
}
