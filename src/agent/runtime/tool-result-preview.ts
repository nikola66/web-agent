/**
 * One-line summary of tool `result` for compact "Tool results (compact JSON)" messages.
 * Must surface real body fields (`content`, `text`, `markdown`, `transcript`, directory listings) —
 * generic `object{…}` hides payloads and causes read_file / snapshot loops.
 */

export function looksLikeBinaryPayload(value: unknown): boolean {
  const isBase64Like = (stripped: string): boolean => {
    if (stripped.length < 2000) return false;
    const sample = stripped.slice(0, 512);
    if (!/^[A-Za-z0-9+/=\s]+$/.test(sample)) return false;
    const compact = sample.replace(/\s/g, "");
    if (compact.length < 2000 && stripped.length < 2000) return false;
    const unique = new Set(compact).size;
    if (unique < 8) return false;
    if (/[+/=]/.test(compact)) return true;
    return /[A-Z]/.test(compact) && /[a-z]/.test(compact) && /[0-9]/.test(compact) && unique >= 16;
  };
  const checkString = (s: string): boolean => {
    const t = s.trim();
    if (t.length < 2000) return false;
    if (/^data:[^;]+;base64,/i.test(t.slice(0, 64))) return true;
    return isBase64Like(t.replace(/\s/g, ""));
  };
  if (typeof value === "string") return checkString(value);
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.base64 === "string" && checkString(obj.base64)) return true;
  for (const key of ["text", "content", "body"]) {
    const raw = obj[key];
    if (typeof raw === "string" && checkString(raw)) return true;
  }
  return false;
}

export function binaryPayloadPreviewLabel(value: unknown): string | null {
  if (!looksLikeBinaryPayload(value)) return null;
  if (typeof value === "string") {
    return `[binary ~${value.length} chars — use web_upload with source_url/file_path; do not inline base64]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const path = typeof obj.path === "string" ? obj.path : null;
    if (path) return `[binary payload — use web_upload or path ${path}]`;
    const n =
      typeof obj.bytes === "number"
        ? obj.bytes
        : typeof obj.base64 === "string"
          ? obj.base64.length
          : typeof obj.text === "string"
            ? obj.text.length
            : 0;
    return `[binary ~${n} chars — use web_upload with source_url/file_path; do not inline base64]`;
  }
  return "[binary payload — use web_upload]";
}

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
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;

  if (obj.data !== undefined && obj.data !== null) {
    if (typeof obj.data === "string" && obj.data.trim()) return obj.data;
    try {
      return JSON.stringify(obj.data, null, 2);
    } catch {
      return String(obj.data);
    }
  }

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

const HTTP_METADATA_PATH_RE =
  /\/(?:collections|schema|metadata|resources|types|items|tables|entities)(?:\/|$|\?)/i;

function slugFromListRow(row: unknown): string | null {
  if (typeof row === "string" && row.trim()) return row.trim();
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  for (const key of ["collection", "slug", "name", "id", "type", "table"]) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

/** Slim slug/id list from large JSON list/metadata API responses (for spilled compact rows). */
export function extractHttpListDigest(result: unknown): { slugs: string[]; total: number } | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url : "";
  if (!url || !HTTP_METADATA_PATH_RE.test(url)) return null;

  let items: unknown[] | null = null;
  if (Array.isArray(obj.data)) {
    items = obj.data;
  } else if (obj.data && typeof obj.data === "object") {
    const nested = obj.data as Record<string, unknown>;
    if (Array.isArray(nested.data)) items = nested.data;
    else if (Array.isArray(nested.items)) items = nested.items;
    else if (Array.isArray(nested.results)) items = nested.results;
  }

  if (!items?.length) return null;

  const slugs: string[] = [];
  const seen = new Set<string>();
  for (const row of items) {
    const slug = slugFromListRow(row);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  if (!slugs.length) return null;
  return { slugs, total: slugs.length };
}

export function summarizeToolResultPreview(value: unknown) {
  const binaryLabel = binaryPayloadPreviewLabel(value);
  if (binaryLabel) return binaryLabel;
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    const compact = value.replace(/\s+/g, " ").trim();
    return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const binaryField = binaryPayloadPreviewLabel(obj);
    if (binaryField) return binaryField;
    for (const key of ["content", "text", "markdown", "transcript", "error"]) {
      const raw = obj[key];
      if (typeof raw === "string" && raw.trim()) {
        const compact = raw.replace(/\s+/g, " ").trim();
        const cap = obj.from_snapshot ? 2_500 : 600;
        const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
        return `${key} (${compact.length} chars): ${excerpt}`;
      }
    }
    if (obj.data !== undefined && obj.data !== null) {
      const serialized =
        typeof obj.data === "string" ? obj.data : JSON.stringify(obj.data);
      const compact = serialized.replace(/\s+/g, " ").trim();
      const cap = obj.from_snapshot ? 2_500 : 800;
      const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
      return `data (${compact.length} chars): ${excerpt}`;
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
