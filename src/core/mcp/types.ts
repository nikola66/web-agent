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

export type McpDiscoveredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  server: string;
  mcpToolName: string;
};

export type McpHostStatus = {
  servers: Array<{
    name: string;
    connected: boolean;
    toolCount: number;
    error?: string;
  }>;
  toolCount: number;
  failed: number;
};

export type McpReloadDiff = {
  added: string[];
  removed: string[];
  reconnected: string[];
  failed: Array<{ name: string; error: string }>;
};
