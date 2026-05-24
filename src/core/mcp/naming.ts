export function sanitizeMcpNameComponent(value: string): string {
  return String(value || "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .toLowerCase();
}

export function mcpToolRegistryName(serverName: string, toolName: string): string {
  return `mcp_${sanitizeMcpNameComponent(serverName)}_${sanitizeMcpNameComponent(toolName)}`;
}

export function mcpEnvKeyForServer(name: string): string {
  return `MCP_${String(name || "")
    .toUpperCase()
    .replace(/-/g, "_")}_API_KEY`;
}
