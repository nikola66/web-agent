export function sanitizeHeadersForFetch(headers: Record<string, unknown> = {}) {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "");
    out[name] = value.replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}
