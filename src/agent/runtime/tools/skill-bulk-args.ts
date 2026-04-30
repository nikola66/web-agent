/**
 * skill_bulk_save accepts `items: [{ url } | { name, content }, ...]`.
 * Models often send a single top-level `url` (registry copy); expand that into `items`.
 */
export function expandSkillBulkSaveArgs(raw: unknown): Record<string, unknown> {
  const a =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const existing = a.items;
  if (Array.isArray(existing) && existing.length > 0) return a;

  const singleUrl = typeof a.url === "string" ? a.url.trim() : "";
  if (singleUrl) {
    const row: Record<string, unknown> = { url: singleUrl };
    const cat = typeof a.category === "string" ? a.category.trim() : "";
    if (cat) row.category = cat;
    a.items = [row];
    return a;
  }

  if (Array.isArray(a.urls)) {
    const urls = (a.urls as unknown[]).map((u) => String(u ?? "").trim()).filter(Boolean);
    if (urls.length > 0) {
      const cat = typeof a.category === "string" ? a.category.trim() : "";
      a.items = urls.map((u) => (cat ? { url: u, category: cat } : { url: u }));
      return a;
    }
  }

  return a;
}
