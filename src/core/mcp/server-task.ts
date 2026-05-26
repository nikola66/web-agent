import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { NodeboxProcess } from "@/runtimes/webcontainer/boot";
import { shouldIncludeTool } from "./config.js";
import { mcpToolRegistryName } from "./naming.js";
import { normalizeMcpInputSchema } from "./schema-normalize.js";
import { buildSafeStdioEnv, NodeboxStdioTransport } from "./stdio-transport.js";
import type { McpDiscoveredTool, McpServerConfig } from "./types.js";
import { createMcpCorsProxyFetch } from "./cors-proxy-fetch.js";

const DEFAULT_CONNECT_TIMEOUT = 60_000;
const MAX_FAILURES = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;

const CREDENTIAL_PATTERN =
  /(?:ghp_[A-Za-z0-9_]{1,255}|sk-[A-Za-z0-9_]{1,255}|Bearer\s+\S+|token=[^\s&,;"']{1,255}|key=[^\s&,;"']{1,255}|API_KEY=[^\s&,;"']{1,255}|password=[^\s&,;"']{1,255}|secret=[^\s&,;"']{1,255})/gi;

export function sanitizeMcpError(text: string): string {
  return String(text || "").replace(CREDENTIAL_PATTERN, "[REDACTED]");
}

export function excMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg || err.name || "Unknown error";
  }
  const text = String(err ?? "").trim();
  return text || "Unknown error";
}

type McpClientModule = typeof import("@modelcontextprotocol/sdk/client/index.js");
type SseModule = typeof import("@modelcontextprotocol/sdk/client/sse.js");
type HttpModule = typeof import("@modelcontextprotocol/sdk/client/streamableHttp.js");

let clientMod: McpClientModule | null = null;
let sseMod: SseModule | null = null;
let httpMod: HttpModule | null = null;

async function getClientMod() {
  clientMod ??= await import("@modelcontextprotocol/sdk/client/index.js");
  return clientMod;
}

async function getSseMod() {
  sseMod ??= await import("@modelcontextprotocol/sdk/client/sse.js");
  return sseMod;
}

async function getHttpMod() {
  httpMod ??= await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  return httpMod;
}

export type McpSpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> }
) => Promise<NodeboxProcess>;

export type McpServerTaskDeps = {
  spawn: McpSpawnFn;
  workspaceCwd?: string;
};

type ListedTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type ConnectedClient = {
  client: InstanceType<McpClientModule["Client"]>;
  transport: Transport;
};

export class McpServerTask {
  private session: ConnectedClient | null = null;
  private tools: ListedTool[] = [];
  private connected = false;
  private lastError = "";
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private callChain: Promise<unknown> = Promise.resolve();
  private readonly toolTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    readonly name: string,
    private config: McpServerConfig,
    private readonly deps: McpServerTaskDeps
  ) {
    this.toolTimeoutMs = Math.max(5_000, (config.timeout ?? 120) * 1000);
    this.connectTimeoutMs = Math.max(5_000, (config.connect_timeout ?? 60) * 1000);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get error(): string {
    return this.lastError;
  }

  getToolCount(): number {
    return this.tools.length;
  }

  discoverTools(): McpDiscoveredTool[] {
    const out: McpDiscoveredTool[] = [];
    for (const tool of this.tools) {
      if (!shouldIncludeTool(tool.name, this.config.tools)) continue;
      out.push({
        name: mcpToolRegistryName(this.name, tool.name),
        description: String(tool.description || `MCP tool ${tool.name} from ${this.name}`).trim(),
        inputSchema: normalizeMcpInputSchema(tool.inputSchema),
        server: this.name,
        mcpToolName: tool.name,
      });
    }
    return out;
  }

  async connect(): Promise<void> {
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error(`Circuit open for MCP server '${this.name}' — retry after cooldown`);
    }
    await this.disconnect();
    const { Client } = await getClientMod();
    let transport = await this.createTransport();
    const client = new Client({ name: "web-agent", version: "1.0.0" }, { capabilities: {} });
    try {
      await withTimeout(client.connect(transport), this.connectTimeoutMs, `connect to MCP server '${this.name}'`);
    } catch (firstErr) {
      if (this.config.url && this.config.transport !== "sse") {
        const { SSEClientTransport } = await getSseMod();
        transport = new SSEClientTransport(new URL(this.config.url), {
          requestInit: { headers: this.config.headers || {} },
        });
        await withTimeout(
          client.connect(transport),
          this.connectTimeoutMs,
          `connect to MCP server '${this.name}' (SSE fallback)`
        );
      } else {
        throw firstErr;
      }
    }
    const listed = await withTimeout(client.listTools(), this.connectTimeoutMs, `list tools for '${this.name}'`);
    this.session = { client, transport };
    this.tools = (listed.tools || []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown>) || {},
    }));
    this.connected = true;
    this.lastError = "";
    this.consecutiveFailures = 0;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    const session = this.session;
    this.session = null;
    this.tools = [];
    try {
      await session?.client.close?.();
    } catch {
      /* ignore */
    }
    try {
      await session?.transport.close?.();
    } catch {
      /* ignore */
    }
  }

  async callTool(toolName: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (!this.session || !this.connected) {
      throw new Error(`MCP server '${this.name}' is not connected`);
    }
    const wait = Math.max(5_000, timeoutMs ?? this.toolTimeoutMs);
    const client = this.session.client;
    const run = async () => {
      return withTimeout(
        client.callTool({ name: toolName, arguments: args }),
        wait,
        `MCP tool '${toolName}' on '${this.name}'`
      );
    };
    const chained = this.callChain.then(run, run);
    this.callChain = chained.catch(() => {});
    return chained;
  }

  recordFailure(err: unknown) {
    this.consecutiveFailures += 1;
    this.lastError = sanitizeMcpError(excMessage(err));
    this.connected = false;
    if (this.consecutiveFailures >= MAX_FAILURES) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  }

  private async createTransport(): Promise<Transport> {
    if (this.config.url) {
      const url = new URL(this.config.url);
      const init: RequestInit = { headers: this.config.headers || {} };
      const proxyFetch = createMcpCorsProxyFetch();
      const transportOpts = {
        requestInit: init,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      };
      if (this.config.transport === "sse") {
        const { SSEClientTransport } = await getSseMod();
        return new SSEClientTransport(url, transportOpts);
      }
      const { StreamableHTTPClientTransport } = await getHttpMod();
      return new StreamableHTTPClientTransport(url, transportOpts);
    }
    const command = String(this.config.command || "").trim();
    const args = Array.isArray(this.config.args) ? this.config.args.map(String) : [];
    if (!command) throw new Error(`MCP server '${this.name}' needs url or command`);
    return new NodeboxStdioTransport({
      command,
      args,
      env: buildSafeStdioEnv(this.config.env || {}),
      cwd: this.deps.workspaceCwd,
      spawn: this.deps.spawn,
    });
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeMcpServer(
  name: string,
  config: McpServerConfig,
  deps: McpServerTaskDeps
): Promise<Array<{ name: string; description: string }>> {
  const task = new McpServerTask(name, config, deps);
  try {
    await task.connect();
    return task.discoverTools().map((t) => ({ name: t.mcpToolName, description: t.description }));
  } finally {
    await task.disconnect();
  }
}
