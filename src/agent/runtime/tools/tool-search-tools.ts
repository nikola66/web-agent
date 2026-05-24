export function isDeferredCatalogTool(name: string, meta: { llmVisible?: boolean } | null | undefined): boolean {
  if (meta?.llmVisible === false) return true;
  return String(name || "").startsWith("mcp_");
}

export async function searchDeferredTools(
  query: string,
  activeToolNames: Set<string>,
  limit = 12
): Promise<Array<{ name: string; description: string; server?: string }>> {
  const { loadToolCatalog } = await import("./registry.js");
  const q = String(query || "").trim().toLowerCase();
  const catalog = await loadToolCatalog();
  const matches: Array<{ name: string; description: string; server?: string; score: number }> = [];
  for (const [name, meta] of Object.entries(catalog)) {
    if (activeToolNames.has(name)) continue;
    if (!isDeferredCatalogTool(name, meta)) continue;
    const description = String(meta?.description || "");
    const haystack = `${name} ${description}`.toLowerCase();
    let score = 0;
    if (!q) score = 1;
    else if (name.toLowerCase().includes(q)) score += 3;
    else if (haystack.includes(q)) score += 1;
    else continue;
    const serverMatch = /\[MCP:([^\]]+)\]/i.exec(description);
    matches.push({
      name,
      description: description.replace(/^\[MCP:[^\]]+\]\s*/, "").trim(),
      ...(serverMatch ? { server: serverMatch[1] } : {}),
      score,
    });
  }
  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return matches.slice(0, Math.max(1, Math.min(25, limit))).map(({ score: _score, ...row }) => row);
}

export async function describeDeferredTool(name: string): Promise<{ name: string; description: string; inputSchema?: Record<string, unknown> } | null> {
  const { loadToolCatalog } = await import("./registry.js");
  const catalog = await loadToolCatalog();
  const meta = catalog[name];
  if (!meta || !isDeferredCatalogTool(name, meta)) return null;
  return {
    name,
    description: String(meta.description || ""),
    inputSchema: meta.inputSchema as Record<string, unknown> | undefined,
  };
}
