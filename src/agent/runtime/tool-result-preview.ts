import { spaShellPageRecoveryHint } from "./tools/tinyfish-fetch.js";

/** True when body looks like an HTML document (SPA shell, login page, CDN error). */
export function looksLikeHtmlDocument(text: unknown): boolean {
  const t = String(text || "").trimStart().slice(0, 512).toLowerCase();
  if (!t.startsWith("<")) return false;
  return (
    t.startsWith("<!doctype") ||
    t.startsWith("<html") ||
    t.startsWith("<head") ||
    t.startsWith("<body") ||
    /^<\?xml[\s>]/.test(t)
  );
}

/** True when a web_fetch/web_post result body is HTML instead of API JSON. */
export function httpResultLooksLikeHtmlShell(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const obj = result as Record<string, unknown>;
  for (const key of ["text", "content", "markdown"]) {
    const v = obj[key];
    if (typeof v === "string" && looksLikeHtmlDocument(v)) return true;
  }
  if (typeof obj.data === "string" && looksLikeHtmlDocument(obj.data)) return true;
  return false;
}

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

  if (typeof obj.text === "string" && obj.text.trim()) {
    if (looksLikeHtmlDocument(obj.text)) {
      return htmlApiBodyRecoveryNote(obj.text, typeof obj.url === "string" ? obj.url : undefined);
    }
    return obj.text;
  }
  if (typeof obj.markdown === "string" && obj.markdown.trim()) return obj.markdown;
  if (typeof obj.transcript === "string" && obj.transcript.trim()) return obj.transcript;
  if (typeof obj.error === "string" && obj.error.trim()) return obj.error;

  if (obj.data !== undefined && obj.data !== null) {
    if (typeof obj.data === "string" && obj.data.trim()) {
      const d = obj.data.trim();
      if (looksLikeHtmlDocument(d)) {
        return htmlApiBodyRecoveryNote(d, typeof obj.url === "string" ? obj.url : undefined);
      }
      return d;
    }
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

function formatHttpItemDigestLine(row: unknown): string | null {
  if (typeof row === "string" && row.trim()) return row.trim();
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;
  const title = [obj.title, obj.name, obj.headline, obj.slug]
    .find((v) => typeof v === "string" && v.trim());
  const date = [obj.date_created, obj.date_updated, obj.published_at, obj.created_at, obj.updated_at]
    .find((v) => typeof v === "string" && v.trim());
  if (typeof title === "string" && title.trim()) {
    const d = typeof date === "string" ? date.trim().slice(0, 10) : "";
    return d ? `${title.trim()} (${d})` : title.trim();
  }
  return slugFromListRow(row);
}

/** Slim list from large JSON list/metadata API responses (for spilled compact rows). */
export function extractHttpListDigest(
  result: unknown
): { slugs: string[]; total: number; preview?: string[] } | null {
  if (!result || typeof result !== "object") return null;
  const obj = result as Record<string, unknown>;
  const url = typeof obj.url === "string" ? obj.url : "";
  if (!url || !HTTP_METADATA_PATH_RE.test(url)) return null;

  let items: unknown[] | null = null;
  if (Array.isArray(obj.data)) {
    items = obj.data;
  } else if (typeof obj.data === "string" && obj.data.trim()) {
    const raw = obj.data.trim();
    if (looksLikeHtmlDocument(raw)) return null;
    if (raw.startsWith("[") || raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) items = parsed;
        else if (parsed && typeof parsed === "object") {
          const nested = parsed as Record<string, unknown>;
          if (Array.isArray(nested.data)) items = nested.data;
          else if (Array.isArray(nested.items)) items = nested.items;
        }
      } catch {
        return null;
      }
    }
  } else if (obj.data && typeof obj.data === "object") {
    const nested = obj.data as Record<string, unknown>;
    if (Array.isArray(nested.data)) items = nested.data;
    else if (Array.isArray(nested.items)) items = nested.items;
    else if (Array.isArray(nested.results)) items = nested.results;
  }

  if (!items?.length) return null;

  const slugs: string[] = [];
  const preview: string[] = [];
  const seen = new Set<string>();
  for (const row of items) {
    const line = formatHttpItemDigestLine(row);
    const slug = slugFromListRow(row);
    if (line && !seen.has(line)) {
      seen.add(line);
      preview.push(line);
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    } else if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
      preview.push(slug);
    }
  }
  if (!preview.length && !slugs.length) return null;
  return {
    slugs: preview.length ? preview : slugs,
    total: items.length,
    preview: preview.length ? preview : undefined,
  };
}

/** Human-readable note when an HTTP tool body is HTML instead of JSON. */
export function htmlApiBodyRecoveryNote(text: unknown, url?: string): string {
  const hint =
    spaShellPageRecoveryHint(text, url) ||
    "Response body is HTML, not JSON — add Authorization (Bearer) on web_fetch/web_post and rerun; do not read_file snapshot spill files that contain HTML.";
  return `[API returned HTML, not JSON] ${hint}`;
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
        if (looksLikeHtmlDocument(raw)) {
          const note = htmlApiBodyRecoveryNote(
            raw,
            typeof obj.url === "string" ? obj.url : undefined
          );
          return `html_shell: ${note.replace(/\s+/g, " ").trim().slice(0, 320)}`;
        }
        const compact = raw.replace(/\s+/g, " ").trim();
        const cap = obj.from_snapshot ? 2_500 : 600;
        const excerpt = compact.length > cap ? `${compact.slice(0, cap)}…` : compact;
        return `${key} (${compact.length} chars): ${excerpt}`;
      }
    }
    if (obj.data !== undefined && obj.data !== null) {
      if (typeof obj.data === "string" && looksLikeHtmlDocument(obj.data)) {
        const note = htmlApiBodyRecoveryNote(
          obj.data,
          typeof obj.url === "string" ? obj.url : undefined
        );
        return `html_shell: ${note.replace(/\s+/g, " ").trim().slice(0, 320)}`;
      }
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
