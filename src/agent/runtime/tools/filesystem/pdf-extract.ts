/**
 * Best-effort PDF text extractor.
 *
 * Pure JS, no deps. Locates `stream`/`endstream` blocks, inflates the ones
 * marked `/FlateDecode`, then scans for text-showing operators (`Tj`, `TJ`,
 * `'`, `"`) and reassembles the literal/hex strings.
 *
 * Known limits:
 *   - Custom font encodings / CID maps are NOT resolved — text from such PDFs
 *     may come out as gibberish or substitution glyphs.
 *   - Encrypted PDFs are not handled.
 *   - Only FlateDecode (the common case) is supported among stream filters.
 *   - Cross-reference streams and object streams (PDF 1.5+) are partially
 *     handled: streams are still scanned, but compressed object containers
 *     emit text in a different shape and may be missed.
 *
 * For high-fidelity extraction the agent should fall back to a node script
 * via `run_shell` once an npm runtime is available.
 */

import fs from "node:fs/promises";
import zlib from "node:zlib";
import { resolveWorkspacePath } from "../../workspace-paths.js";
import { toolPathStringFromArgs } from "./path-hints.js";

function indexOfBuffer(haystack: Buffer, needle: Buffer, from = 0): number {
  return haystack.indexOf(needle, from);
}

function tryInflate(data: Buffer): Buffer | null {
  // Try zlib first (most PDFs); fall back to raw deflate.
  try { return zlib.inflateSync(data); } catch { /* try next */ }
  try { return zlib.inflateRawSync(data); } catch { /* give up */ }
  return null;
}

/** ASCII85 (Adobe) decode. Strips optional `<~`/`~>` framing. */
function decodeAscii85(data: Buffer): Buffer | null {
  let s = data.toString("latin1");
  // Strip framing + whitespace.
  if (s.startsWith("<~")) s = s.slice(2);
  const endIdx = s.indexOf("~>");
  if (endIdx !== -1) s = s.slice(0, endIdx);
  s = s.replace(/\s+/g, "");

  const out: number[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === "z") {
      out.push(0, 0, 0, 0);
      i++;
      continue;
    }
    let group = 0;
    let count = 0;
    while (count < 5 && i < s.length) {
      const c = s.charCodeAt(i);
      if (c < 33 || c > 117) return null;
      group = group * 85 + (c - 33);
      count++;
      i++;
    }
    const pad = 5 - count;
    for (let k = 0; k < pad; k++) group = group * 85 + 84;
    const bytes = [
      (group >>> 24) & 0xff,
      (group >>> 16) & 0xff,
      (group >>> 8) & 0xff,
      group & 0xff,
    ];
    for (let k = 0; k < 4 - pad; k++) out.push(bytes[k]);
  }
  return Buffer.from(out);
}

/** ASCIIHex decode. Each pair of hex chars is one byte; `>` terminates. */
function decodeAsciiHex(data: Buffer): Buffer | null {
  let s = data.toString("latin1").replace(/\s+/g, "");
  const endIdx = s.indexOf(">");
  if (endIdx !== -1) s = s.slice(0, endIdx);
  if (s.length % 2 === 1) s += "0";
  const out = Buffer.allocUnsafe(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    const n = parseInt(s.substr(i, 2), 16);
    if (!Number.isFinite(n)) return null;
    out[i / 2] = n;
  }
  return out;
}

/**
 * Parse the `/Filter` value out of a PDF stream dictionary.
 * PDF spec: filters in the array are listed in DECODING order, so we apply
 * them as-is (first element first).
 */
function parseFilterChain(dict: string): string[] {
  const arrayMatch = dict.match(/\/Filter\s*\[([^\]]+)\]/);
  if (arrayMatch) {
    return (arrayMatch[1].match(/\/[A-Za-z0-9]+/g) || []).map((n) => n.slice(1));
  }
  const singleMatch = dict.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  if (singleMatch) return [singleMatch[1]];
  return [];
}

function applyFilters(payload: Buffer, filters: string[]): Buffer | null {
  let cur: Buffer = payload;
  for (const filter of filters) {
    let next: Buffer | null;
    switch (filter) {
      case "FlateDecode":
      case "Fl":
        next = tryInflate(cur);
        break;
      case "ASCII85Decode":
      case "A85":
        next = decodeAscii85(cur);
        break;
      case "ASCIIHexDecode":
      case "AHx":
        next = decodeAsciiHex(cur);
        break;
      default:
        return null; // LZWDecode, RunLengthDecode, DCT, CCITTFax, JBIG2, JPX — unsupported.
    }
    if (!next) return null;
    cur = next;
  }
  return cur;
}

const STREAM = Buffer.from("\nstream");
const STREAM2 = Buffer.from("\rstream");
const ENDSTREAM = Buffer.from("endstream");

function* iterateStreams(buf: Buffer): Generator<{ dict: string; payload: Buffer }> {
  let p = 0;
  while (p < buf.length) {
    // Find "stream" preceded by newline.
    let s = indexOfBuffer(buf, STREAM, p);
    let s2 = indexOfBuffer(buf, STREAM2, p);
    let start = -1;
    if (s === -1 && s2 === -1) return;
    if (s === -1) start = s2; else if (s2 === -1) start = s; else start = Math.min(s, s2);

    // Dictionary preceding the stream lives between the last "<<" and ">>".
    const dictEnd = buf.lastIndexOf(">>", start);
    const dictStart = buf.lastIndexOf("<<", dictEnd);
    const dict = dictStart >= 0 && dictEnd > dictStart
      ? buf.slice(dictStart, dictEnd + 2).toString("latin1")
      : "";

    // Payload begins after "stream\n" or "stream\r\n".
    let dataStart = start + "stream".length + 1; // +1 for the leading \n or \r
    if (buf[dataStart] === 0x0a) dataStart++;
    const end = indexOfBuffer(buf, ENDSTREAM, dataStart);
    if (end === -1) return;
    let dataEnd = end;
    while (dataEnd > dataStart && (buf[dataEnd - 1] === 0x0a || buf[dataEnd - 1] === 0x0d || buf[dataEnd - 1] === 0x20)) {
      dataEnd--;
    }
    yield { dict, payload: buf.slice(dataStart, dataEnd) };
    p = end + ENDSTREAM.length;
  }
}

function decodePdfStringLiteral(body: string): string {
  // Handles `(...)` content with escape sequences and balanced parens.
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") { out += c; continue; }
    const next = body[i + 1];
    i++;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next >= "0" && next <= "7") {
      // Up to 3 octal digits.
      let oct = next;
      if (body[i + 1] >= "0" && body[i + 1] <= "7") { oct += body[i + 1]; i++; }
      if (body[i + 1] >= "0" && body[i + 1] <= "7") { oct += body[i + 1]; i++; }
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next === "\n" || next === "\r") {
      // Line continuation — drop.
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hex: string): string {
  let cleaned = hex.replace(/\s+/g, "");
  if (cleaned.length % 2 === 1) cleaned += "0";
  let out = "";
  for (let i = 0; i < cleaned.length; i += 2) {
    const code = parseInt(cleaned.substr(i, 2), 16);
    if (Number.isFinite(code)) out += String.fromCharCode(code);
  }
  return out;
}

function extractTextFromContent(content: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    if (c === "(") {
      // Find matching close, respecting escapes + nesting.
      let depth = 1;
      let j = i + 1;
      while (j < content.length && depth > 0) {
        const ch = content[j];
        if (ch === "\\") { j += 2; continue; }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (depth === 0) break; }
        j++;
      }
      const body = content.slice(i + 1, j);
      parts.push(decodePdfStringLiteral(body));
      i = j + 1;
    } else if (c === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i + 1);
      if (end === -1) break;
      const hex = content.slice(i + 1, end);
      parts.push(decodePdfHexString(hex));
      i = end + 1;
    } else if (c === "T" && (content[i + 1] === "j" || content[i + 1] === "J" || content[i + 1] === "d" || content[i + 1] === "*")) {
      // After Tj/TJ/Td/T*, emit a separator so adjacent strings don't merge.
      if (content[i + 1] === "j" || content[i + 1] === "J") parts.push(" ");
      else parts.push("\n");
      i += 2;
    } else {
      i++;
    }
  }
  return parts.join("");
}

function looksLikePrintable(s: string): boolean {
  if (!s) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(s.length, 400); i++) {
    const code = s.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code >= 160) printable++;
  }
  return printable / Math.min(s.length, 400) > 0.7;
}

export type PdfExtractResult = {
  ok: true;
  path: string;
  bytes: number;
  characters: number;
  text: string;
  truncated: boolean;
  streamsScanned: number;
  notes: string[];
};

const DEFAULT_MAX_CHARS = 500_000;

export async function pdfExtract(
  ctx: unknown,
  args: { path?: string; max_chars?: number; [key: string]: unknown } = {}
): Promise<PdfExtractResult> {
  const rel =
    (typeof args.path === "string" && args.path.trim()) ||
    toolPathStringFromArgs(args as Record<string, unknown>);
  if (!rel) throw new Error("pdf_extract requires `path` (aliases: `file`, `file_path`, `filename`).");
  const abs = resolveWorkspacePath(ctx, rel);
  const buf = await fs.readFile(abs);
  if (!buf.slice(0, 5).toString("ascii").startsWith("%PDF-")) {
    throw new Error(`pdf_extract: ${rel} does not begin with %PDF- header`);
  }
  if (buf.includes(Buffer.from("/Encrypt"))) {
    throw new Error(`pdf_extract: ${rel} appears to be encrypted (contains /Encrypt). Not supported.`);
  }

  const notes: string[] = [];
  const pieces: string[] = [];
  let streamsScanned = 0;
  let nonFlateSkipped = 0;
  let gibberishSkipped = 0;

  for (const { dict, payload } of iterateStreams(buf)) {
    streamsScanned++;
    const filters = parseFilterChain(dict);
    let body: Buffer | null;
    if (filters.length === 0) {
      body = payload;
    } else {
      body = applyFilters(payload, filters);
      if (!body) {
        nonFlateSkipped++;
        continue;
      }
    }
    const asString = body.toString("latin1");
    // Heuristic: only scan content streams (those that contain BT...ET) or
    // any stream where Tj operators appear.
    if (!/Tj|TJ/.test(asString)) continue;
    const extracted = extractTextFromContent(asString);
    if (!extracted.trim()) continue;
    if (!looksLikePrintable(extracted)) {
      gibberishSkipped++;
      continue;
    }
    pieces.push(extracted);
  }

  if (nonFlateSkipped > 0) notes.push(`Skipped ${nonFlateSkipped} stream(s) with unsupported filters.`);
  if (gibberishSkipped > 0) notes.push(`Skipped ${gibberishSkipped} stream(s) that looked like non-Unicode font glyphs.`);
  if (!pieces.length) {
    notes.push("No readable text found — the PDF may use custom font encoding, be scanned images, or be encrypted.");
  }

  let text = pieces.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const maxChars =
    typeof args.max_chars === "number" && args.max_chars > 0 ? args.max_chars : DEFAULT_MAX_CHARS;
  const truncated = text.length > maxChars;
  if (truncated) text = `${text.slice(0, maxChars)}\n…[truncated]`;

  return {
    ok: true,
    path: rel,
    bytes: buf.byteLength,
    characters: text.length,
    text,
    truncated,
    streamsScanned,
    notes,
  };
}
