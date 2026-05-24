import { listEnabledServers } from "./config.js";
import { McpServerTask, probeMcpServer, excMessage, sanitizeMcpError, type McpSpawnFn } from "./server-task.js";
import type { McpDiscoveredTool, McpHostStatus, McpReloadDiff, McpServersConfig } from "./types.js";

export type McpHostOptions = {
  spawn: McpSpawnFn;
  workspaceCwd?: string;
};

export class McpHost {
  private servers = new Map<string, McpServerTask>();

  constructor(private readonly options: McpHostOptions) {}

  getStatus(): McpHostStatus {
    const rows = [...this.servers.entries()].map(([name, task]) => ({
      name,
      connected: task.isConnected,
      toolCount: task.getToolCount(),
      ...(task.error ? { error: task.error } : {}),
    }));
    const failed = rows.filter((r) => !r.connected).length;
    return {
      servers: rows,
      toolCount: rows.reduce((n, r) => n + r.toolCount, 0),
      failed,
    };
  }

  listDiscoveredTools(): McpDiscoveredTool[] {
    const out: McpDiscoveredTool[] = [];
    for (const task of this.servers.values()) {
      if (!task.isConnected) continue;
      out.push(...task.discoverTools());
    }
    return out;
  }

  async discover(config: McpServersConfig, env: Record<string, string> = {}): Promise<McpDiscoveredTool[]> {
    await this.shutdown();
    const enabled = listEnabledServers(config, env);
    await Promise.all(
      enabled.map(async ([name, serverConfig]) => {
        const task = new McpServerTask(name, serverConfig, {
          spawn: this.options.spawn,
          workspaceCwd: this.options.workspaceCwd,
        });
        try {
          await task.connect();
          this.servers.set(name, task);
        } catch (err) {
          task.recordFailure(err);
          this.servers.set(name, task);
        }
      })
    );
    return this.listDiscoveredTools();
  }

  async reload(config: McpServersConfig, env: Record<string, string> = {}): Promise<McpReloadDiff> {
    const before = new Set([...this.servers.keys()]);
    const prevConnected = new Map(
      [...this.servers.entries()].map(([name, task]) => [name, task.isConnected])
    );
    await this.shutdown();
    await this.discover(config, env);
    const after = new Set([...this.servers.keys()]);
    const added = [...after].filter((n) => !before.has(n));
    const removed = [...before].filter((n) => !after.has(n));
    const reconnected = [...after].filter(
      (n) => before.has(n) && this.servers.get(n)?.isConnected && prevConnected.get(n) === false
    );
    const failed: McpReloadDiff["failed"] = [];
    for (const [name, task] of this.servers.entries()) {
      if (!task.isConnected) {
        failed.push({ name, error: task.error || "connection failed" });
      }
    }
    return { added, removed, reconnected, failed };
  }

  async callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<unknown> {
    const task = this.servers.get(server);
    if (!task) throw new Error(`MCP server '${server}' is not configured or connected`);
    try {
      return await task.callTool(tool, args, timeoutMs);
    } catch (err) {
      task.recordFailure(err);
      throw new Error(sanitizeMcpError(excMessage(err)));
    }
  }

  async probe(name: string, config: McpServersConfig, env: Record<string, string> = {}) {
    const entry = config[name];
    if (!entry) throw new Error(`MCP server '${name}' not found in config`);
    const enabled = listEnabledServers({ [name]: entry }, env);
    if (!enabled.length) throw new Error(`MCP server '${name}' is disabled`);
    const [, resolved] = enabled[0];
    return probeMcpServer(name, resolved, {
      spawn: this.options.spawn,
      workspaceCwd: this.options.workspaceCwd,
    });
  }

  async shutdown(): Promise<void> {
    const tasks = [...this.servers.values()];
    this.servers.clear();
    await Promise.all(tasks.map((t) => t.disconnect().catch(() => {})));
  }
}

const hostsByProfile = new Map<string, McpHost>();

export function getMcpHost(profileId: string, options: McpHostOptions): McpHost {
  let host = hostsByProfile.get(profileId);
  if (!host) {
    host = new McpHost(options);
    hostsByProfile.set(profileId, host);
  }
  return host;
}

export async function shutdownMcpHost(profileId: string): Promise<void> {
  const host = hostsByProfile.get(profileId);
  if (!host) return;
  await host.shutdown();
  hostsByProfile.delete(profileId);
}
