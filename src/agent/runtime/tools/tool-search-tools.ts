const HIDDEN_BROWSE_ALIASES = new Set(["list_dir", "find_files", "tree"]);

export function isHiddenBrowseAlias(name: string): boolean {
  return HIDDEN_BROWSE_ALIASES.has(String(name || ""));
}

export function isDeferredCatalogTool(name: string, meta: { llmVisible?: boolean } | null | undefined): boolean {
  if (String(name || "").startsWith("mcp_")) return false;
  if (meta?.llmVisible === false) return true;
  return false;
}

export async function searchDeferredTools(
  query: string,
  activeToolNames: Set<string>,
  limit = 12,
  catalogOverride?: Record<string, { description?: string; llmVisible?: boolean } | undefined>
): Promise<Array<{ name: string; description: string; server?: string }>> {
  const q = String(query || "").trim().toLowerCase();
  const catalog =
    catalogOverride ?? (await import("./registry.js").then((m) => m.loadToolCatalog()));
  const matches: Array<{ name: string; description: string; server?: string; score: number }> = [];
  for (const [name, meta] of Object.entries(catalog)) {
    if (activeToolNames.has(name)) continue;
    if (!isDeferredCatalogTool(name, meta)) continue;
    const description = String(meta?.description || "");
    const haystack = `${name} ${description}`.toLowerCase();
    let score = 0;
    if (!q) {
      if (!isHiddenBrowseAlias(name)) continue;
      score = 1;
    } else if (name.toLowerCase().includes(q)) {
      score += 3;
    } else if (haystack.includes(q)) {
      score += 1;
    } else {
      continue;
    }
    const serverMatch = /\[MCP:([^\]]+)\]/i.exec(description);
    matches.push({
      name,
      description: description.replace(/^\[MCP:[^\]]+\]\s*/, "").trim(),
      ...(serverMatch ? { server: serverMatch[1] } : {}),
      score,
    });
  }
  matches.sort((a, b) => {
    const tier = (n: string) => (isHiddenBrowseAlias(n) ? 0 : 1);
    return b.score - a.score || tier(b.name) - tier(a.name) || a.name.localeCompare(b.name);
  });
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
