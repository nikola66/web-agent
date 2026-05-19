/**
 * One-line summary of tool `result` for compact "Tool results (compact JSON)" messages.
 * Must surface real body fields (`content`, `text`, `markdown`, `transcript`, directory listings) —
 * generic `object{…}` hides payloads and causes read_file / snapshot loops.
 */

function formatDirEntryLines(entries: unknown[]): string[] {
  const lines: string[] = [];
  for (const e of entries) {
    if (typeof e === "string" && e.trim()) {
      lines.push(e.trim());
      continue;
    }
    if (!e || typeof e !== "object") continue;
    const row = e as { path?: string; name?: string; kind?: string };
    const path = typeof row.path === "string" ? row.path : row.name;
    if (!path?.trim()) continue;
    const kind = row.kind ? ` [${row.kind}]` : "";
    lines.push(`${path.trim()}${kind}`);
  }
  return lines;
}

/**
 * Flatten list_dir / find_files (and similar) into newline-separated paths for the model.
 */
export function formatDirectoryListingFromToolResult(inner: Record<string, unknown>): string | null {
  if (!inner || typeof inner !== "object") return null;

  if (Array.isArray(inner.entries) && inner.entries.length > 0) {
    const lines = formatDirEntryLines(inner.entries);
    if (!lines.length) return null;
    const header: string[] = [];
    if (typeof inner.scanned === "number") header.push(`scanned: ${inner.scanned}`);
    if (inner.truncated === true) header.push("truncated: true");
    const body = lines.join("\n");
    return header.length ? `${header.join(", ")}\n${body}` : body;
  }

  if (Array.isArray(inner.files) && inner.files.length > 0) {
    const lines = inner.files
      .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
      .map((f) => f.trim());
    if (!lines.length) return null;
    const header: string[] = [];
    if (typeof inner.scanned === "number") header.push(`scanned: ${inner.scanned}`);
    if (inner.truncated === true) header.push("truncated: true");
    const body = lines.join("\n");
    return header.length ? `${header.join(", ")}\n${body}` : body;
  }

  return null;
}

/**
 * Primary human-readable body for a tool result object (used by compact previews and snapshot unwrap).
 */
export function extractToolResultBodyText(inner: unknown): string | null {
  if (!inner || typeof inner !== "object") return null;
  const obj = inner as Record<string, unknown>;

  if (typeof obj.text === "string" && obj.text.trim()) return obj.text;
  if (typeof obj.markdown === "string" && obj.markdown.trim()) return obj.markdown;
  if (typeof obj.transcript === "string" && obj.transcript.trim()) return obj.transcript;

  if (typeof obj.content === "string" && obj.content.trim()) {
    const c = obj.content;
    if (c.startsWith("{") && c.includes('"payload"')) {
      try {
        const nested = JSON.parse(c) as { payload?: { result?: unknown } };
        const pl = nested?.payload;
        if (pl?.result) return extractToolResultBodyText(pl.result);
      } catch {
        /* use raw content string */
      }
    }
    return c;
  }

  return formatDirectoryListingFromToolResult(obj);
}

export function summarizeToolResultPreview(value: unknown) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["content", "text", "markdown", "transcript"]) {
      const raw = obj[key];
      if (typeof raw === "string" && raw.trim()) {
        const compact = raw.replace(/\s+/g, " ").trim();
        const cap = obj.from_snapshot ? 2_500 : 600;
        const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
        return `${key} (${compact.length} chars): ${excerpt}`;
      }
    }
    const listing = extractToolResultBodyText(obj);
    if (listing) {
      const compact = listing.replace(/\s+/g, " ").trim();
      const cap = obj.from_snapshot ? 2_500 : 800;
      const label = Array.isArray(obj.entries) ? "entries" : "files";
      const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
      return `${label} (${compact.length} chars): ${excerpt}`;
    }
    const keys = Object.keys(value);
    const keyList = keys.slice(0, 6).join(", ");
    return `object{${keyList}${keys.length > 6 ? ", …" : ""}}`;
  }
  return String(value);
}
