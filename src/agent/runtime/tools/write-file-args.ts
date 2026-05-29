/**
 * write_file argument recovery and size limits.
 * Large markdown bodies often break strict JSON.parse; salvage path/content from the raw wire string.
 */

export const WRITE_FILE_MAX_BYTES = Math.max(
  65_536,
  Math.min(
    32 * 1024 * 1024,
    Number(process.env.WEBAGENT_WRITE_FILE_MAX_BYTES) || 16 * 1024 * 1024
  )
);

const PATH_KEY_RE = /"(?:path|file|filename|file_path|filepath|target)"\s*:\s*"/;
const CONTENT_KEY_RE = /"(?:content|contents|text|data|markdown|body)"\s*:\s*"/;

export function normalizeWriteFileArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out = { ...args };
  if (out.content === undefined && out.contents !== undefined) out.content = out.contents;
  if (out.content === undefined && typeof out.text === "string") out.content = out.text;
  if (out.content === undefined && typeof out.data === "string") out.content = out.data;
  if (out.content === undefined && typeof out.markdown === "string") out.content = out.markdown;
  if (out.content === undefined && typeof out.body === "string") out.content = out.body;
  return out;
}

function unescapeJsonStringFragment(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) {
      out += ch;
      continue;
    }
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else     if (next === "u" && /^u[0-9a-fA-F]{4}/.test(raw.slice(i + 1, i + 6))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
      i += 5;
    } else out += next;
    i += 1;
  }
  return out;
}

function readJsonStringValue(text: string, startIdx: number): { value: string; end: number } | null {
  if (text[startIdx] !== '"') return null;
  let i = startIdx + 1;
  let raw = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      raw += ch;
      if (i + 1 < text.length) {
        raw += text[i + 1];
        i += 2;
        continue;
      }
      break;
    }
    if (ch === '"') {
      return { value: unescapeJsonStringFragment(raw), end: i + 1 };
    }
    raw += ch;
    i += 1;
  }
  return { value: unescapeJsonStringFragment(raw), end: i };
}

function readJsonStringField(text: string, keyRe: RegExp): string | null {
  const m = keyRe.exec(text);
  if (!m) return null;
  const parsed = readJsonStringValue(text, m.index + m[0].length - 1);
  return parsed?.value ?? null;
}

/** Best-effort extraction when JSON.parse fails or returns an empty object on large writes. */
export function salvageWriteFileArgumentsFromRawJson(raw: unknown): Record<string, unknown> | null {
  const text = String(raw ?? "").trim();
  if (!text || text === "{}") return null;
  const path = readJsonStringField(text, PATH_KEY_RE);
  if (!path) return null;
  const contentMatch = CONTENT_KEY_RE.exec(text);
  if (!contentMatch) return null;
  const contentStart = contentMatch.index + contentMatch[0].length - 1;
  const contentParsed = readJsonStringValue(text, contentStart);
  if (!contentParsed) return null;
  return { path, content: contentParsed.value };
}

export function writeFileArgsMissing(args: Record<string, unknown>): string[] {
  const normalized = normalizeWriteFileArgs(args);
  const missing: string[] = [];
  const path =
    typeof normalized.path === "string"
      ? normalized.path.trim()
      : typeof normalized.file === "string"
        ? normalized.file.trim()
        : "";
  if (!path) missing.push("path");
  if (normalized.content === undefined) missing.push("content");
  return missing;
}

export function parseWriteFileToolArguments(
  raw: unknown,
  parsed: Record<string, unknown>
): Record<string, unknown> {
  let args = normalizeWriteFileArgs(parsed);
  if (!writeFileArgsMissing(args).length) return args;
  if (typeof raw === "string") {
    const salvaged = salvageWriteFileArgumentsFromRawJson(raw);
    if (salvaged) args = normalizeWriteFileArgs({ ...args, ...salvaged });
  }
  return args;
}

export function formatWriteFileMaxBytesHint(): string {
  const mib = (WRITE_FILE_MAX_BYTES / (1024 * 1024)).toFixed(WRITE_FILE_MAX_BYTES % (1024 * 1024) === 0 ? 0 : 1);
  return `Max ${mib} MiB per write_file (WEBAGENT_WRITE_FILE_MAX_BYTES).`;
}

export function formatWriteFileMissingFieldsHint(missing: string[]): string {
  const max = formatWriteFileMaxBytesHint();
  if (missing.includes("path") && missing.includes("content")) {
    return (
      `Emit one JSON object (no markdown code fence around the tool call): ` +
      `{"path":"projects/<slug>/article.md","content":"# Title\\n\\n..."}. ` +
      `Aliases map to content/path automatically. ${max}`
    );
  }
  if (missing.includes("content")) {
    return `Add string field "content" with the full file body in the same JSON object as "path". ${max}`;
  }
  if (missing.includes("path")) {
    return `Add string field "path" (workspace-relative), e.g. "projects/blog/bitnet.md". ${max}`;
  }
  return max;
}
