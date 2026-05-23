/**
 * Best-effort DOCX → plain-text extractor.
 *
 * DOCX is a ZIP containing `word/document.xml`. We reuse the archive parser,
 * then strip XML to keep paragraph and heading breaks.
 *
 * Trade-offs vs. the `mammoth` library:
 *   - No style mapping (no real markdown).
 *   - No image/embed extraction.
 *   - Tables flatten to tab-separated rows.
 * Good enough for the agent to read what the user wrote.
 */

import { loadAndParseArchive } from "./archive.js";
import { resolveWorkspacePath } from "../../workspace-paths.js";

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function documentXmlToText(xml: string): string {
  // Insert separators for structural elements before stripping tags.
  let s = xml
    .replace(/<w:tab[\s/>][^>]*>/g, "\t")
    .replace(/<w:br[\s/>][^>]*>/g, "\n")
    .replace(/<w:p[\s>][^>]*>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  s = decodeXmlEntities(s);
  // Collapse excessive blank lines and trailing spaces.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export type DocxExtractResult = {
  ok: true;
  path: string;
  bytes: number;
  characters: number;
  text: string;
  truncated: boolean;
};

const DEFAULT_MAX_CHARS = 500_000;

export async function docxExtract(
  ctx: unknown,
  args: { path: string; max_chars?: number }
): Promise<DocxExtractResult> {
  const rel = String(args.path || "").trim();
  if (!rel) throw new Error("docx_extract requires `path`");
  const abs = resolveWorkspacePath(ctx, rel);
  const parsed = await loadAndParseArchive(abs);
  if (parsed.format !== "zip") {
    throw new Error(`docx_extract: ${rel} is not a ZIP-based DOCX (got format=${parsed.format})`);
  }
  const docEntry = parsed.entries.find((e) => e.name === "word/document.xml");
  if (!docEntry) {
    throw new Error(`docx_extract: ${rel} missing word/document.xml — not a valid .docx`);
  }
  const xml = parsed.read("word/document.xml").toString("utf8");
  const text = documentXmlToText(xml);
  const maxChars =
    typeof args.max_chars === "number" && args.max_chars > 0 ? args.max_chars : DEFAULT_MAX_CHARS;
  const truncated = text.length > maxChars;
  const output = truncated ? `${text.slice(0, maxChars)}\n…[truncated]` : text;
  return {
    ok: true,
    path: rel,
    bytes: Buffer.byteLength(xml, "utf8"),
    characters: output.length,
    text: output,
    truncated,
  };
}
