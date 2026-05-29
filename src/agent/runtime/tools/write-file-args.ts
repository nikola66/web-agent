/**
 * write_file / edit_file argument recovery and size limits.
 * Large bodies break JSON.parse; salvage path/content from the raw wire string.
 */

export const WRITE_FILE_MAX_BYTES = Math.max(
  65_536,
  Math.min(
    32 * 1024 * 1024,
    Number(process.env.WEBAGENT_WRITE_FILE_MAX_BYTES) || 16 * 1024 * 1024
  )
);

const PATH_KEY_RE = /"(?:path|file|filename|file_path|filepath|target)"\s*:\s*"/i;
const PATH_LOOSE_RE = /"(?:path|file|filename|file_path|filepath|target)"\s*:\s*"((?:\\.|[^"\\])*)/i;
const CONTENT_KEY_RE = /"(?:content|contents|text|data|markdown|body|new_content)"\s*:\s*/i;
const EDIT_CONTENT_KEY_RE = /"(?:new_content|content|contents|text|data|markdown|body)"\s*:\s*/i;

export function normalizeWireText(raw: unknown): string {
  let text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json|markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  }
  return text.trim();
}

export function normalizeWriteFileArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out = { ...args };
  if (out.content === undefined && out.contents !== undefined) out.content = out.contents;
  if (out.content === undefined && typeof out.text === "string") out.content = out.text;
  if (out.content === undefined && typeof out.data === "string") out.content = out.data;
  if (out.content === undefined && typeof out.markdown === "string") out.content = out.markdown;
  if (out.content === undefined && typeof out.body === "string") out.content = out.body;
  if (out.content === undefined && typeof out.new_content === "string") out.content = out.new_content;
  return out;
}

export function normalizeEditFileArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out = { ...args };
  if (typeof out.path !== "string" || !out.path.trim()) {
    const picked =
      typeof out.file === "string"
        ? out.file
        : typeof out.file_path === "string"
          ? out.file_path
          : typeof out.filename === "string"
            ? out.filename
            : "";
    if (picked.trim()) out.path = picked.trim();
  }
  if (out.new_content === undefined && out.content !== undefined) out.new_content = out.content;
  if (out.new_content === undefined && typeof out.text === "string") out.new_content = out.text;
  if (out.new_content === undefined && typeof out.body === "string") out.new_content = out.body;
  if (out.new_content === undefined && typeof out.markdown === "string") out.new_content = out.markdown;
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
    else if (next === "u" && /^u[0-9a-fA-F]{4}/.test(raw.slice(i + 1, i + 6))) {
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

function readLooseFieldValue(text: string, valueStart: number): string | null {
  let i = valueStart;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  if (text[i] === '"') {
    return readJsonStringValue(text, i)?.value ?? null;
  }
  const rest = text.slice(i);
  const endMatch = rest.match(/\n\s*"(?:path|content|contents|find|replace|new_content|text|data)"\s*:/i);
  const end = endMatch?.index ?? rest.length;
  return rest.slice(0, end).replace(/,\s*$/, "").trim();
}

function readPathFromWire(text: string): string | null {
  const strict = PATH_KEY_RE.exec(text);
  if (strict) {
    const parsed = readJsonStringValue(text, strict.index + strict[0].length - 1);
    if (parsed?.value) return parsed.value;
  }
  const loose = PATH_LOOSE_RE.exec(text);
  if (loose?.[1]) {
    try {
      return JSON.parse(`"${loose[1]}"`);
    } catch {
      return loose[1].replace(/\\"/g, '"');
    }
  }
  return null;
}

function readContentFromWire(text: string, keyRe: RegExp): string | null {
  const m = keyRe.exec(text);
  if (!m) return null;
  return readLooseFieldValue(text, m.index + m[0].length);
}

/** Best-effort extraction when JSON.parse fails or returns an empty object. */
export function salvageWriteFileArgumentsFromRawJson(raw: unknown): Record<string, unknown> | null {
  const text = normalizeWireText(raw);
  if (!text || text === "{}") return null;
  const path = readPathFromWire(text);
  if (!path) return null;
  const content = readContentFromWire(text, CONTENT_KEY_RE);
  if (content === null) return null;
  return { path, content };
}

export function salvageEditFileArgumentsFromRawJson(raw: unknown): Record<string, unknown> | null {
  const text = normalizeWireText(raw);
  if (!text || text === "{}") return null;
  const path = readPathFromWire(text);
  if (!path) return null;
  const new_content = readContentFromWire(text, EDIT_CONTENT_KEY_RE);
  if (new_content === null) {
    return { path };
  }
  return { path, new_content };
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

export function editFileArgsMissing(args: Record<string, unknown>): string[] {
  const normalized = normalizeEditFileArgs(args);
  const missing: string[] = [];
  if (typeof normalized.path !== "string" || !normalized.path.trim()) missing.push("path");
  return missing;
}

function wireTextForSalvage(raw: unknown): string {
  if (typeof raw === "string") return normalizeWireText(raw);
  if (raw && typeof raw === "object" && Object.keys(raw as object).length > 0) {
    try {
      return normalizeWireText(JSON.stringify(raw));
    } catch {
      return "";
    }
  }
  return normalizeWireText(raw);
}

export function parseWriteFileToolArguments(
  raw: unknown,
  parsed: Record<string, unknown>
): Record<string, unknown> {
  let args = normalizeWriteFileArgs(parsed);
  if (!writeFileArgsMissing(args).length) return args;
  const wire = wireTextForSalvage(raw);
  if (wire) {
    const salvaged = salvageWriteFileArgumentsFromRawJson(wire);
    if (salvaged) args = normalizeWriteFileArgs({ ...args, ...salvaged });
  }
  return args;
}

export function parseEditFileToolArguments(
  raw: unknown,
  parsed: Record<string, unknown>
): Record<string, unknown> {
  let args = normalizeEditFileArgs(parsed);
  if (!editFileArgsMissing(args).length) return args;
  const wire = wireTextForSalvage(raw);
  if (wire) {
    const salvaged = salvageEditFileArgumentsFromRawJson(wire);
    if (salvaged) args = normalizeEditFileArgs({ ...args, ...salvaged });
  }
  return args;
}

export function formatWriteFileMaxBytesHint(): string {
  const mib = (WRITE_FILE_MAX_BYTES / (1024 * 1024)).toFixed(WRITE_FILE_MAX_BYTES % (1024 * 1024) === 0 ? 0 : 1);
  return `Max ${mib} MiB per write_file (WEBAGENT_WRITE_FILE_MAX_BYTES).`;
}

const WRITE_FILE_SHORT_HINT =
  'Use native tool JSON only: {"path":"projects/<slug>/file.md","content":"..."}. ' +
  "If the body is huge, set append:true on a second+ call, or run_python: open(path,'a').write(chunk).";

export function formatWriteFileMissingFieldsHint(_missing: string[]): string {
  return `${WRITE_FILE_SHORT_HINT} ${formatWriteFileMaxBytesHint()}`;
}

export function formatEditFileMissingFieldsHint(): string {
  return (
    'edit_file needs {"path":"projects/<slug>/file.md"} plus either find+replace or new_content for full replace. ' +
    WRITE_FILE_SHORT_HINT
  );
}

export function formatWriteFileLoopRecoveryHint(): string {
  return (
    "write_file JSON was empty or unparsable — do not retry the same shape. " +
    "Either emit a complete {\"path\",\"content\"} object via native tool_calls (no markdown fence), " +
    "or write with run_python: open('projects/.../file.md','w',encoding='utf-8').write(body), " +
    "or use write_file with append:true in 2–4 smaller chunks."
  );
}
