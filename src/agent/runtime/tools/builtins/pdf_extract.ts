import { defineTool } from "../definition.js";
import { pdfExtract } from "../filesystem/pdf-extract.js";

export default defineTool({
  name: "pdf_extract",
  run: pdfExtract as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "📕",
  description:
    "Best-effort plain-text extraction from a PDF — try before `run_python` for simple text. Required: `path` (workspace-relative). " +
    "Optional: `max_chars` (default 500000). Supports FlateDecode content streams; " +
    "encrypted PDFs and PDFs with custom font encodings (often: scanned, exported from design tools) may return gibberish or empty text. " +
    "If `text` is empty or unreadable, treat the PDF as needing OCR / a richer extractor and tell the user. " +
    "Returns { ok, path, bytes, characters, text, truncated, streamsScanned, notes }.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative .pdf path." },
      max_chars: { type: "number", description: "Cap on returned text characters (default 500000)." },
    },
    required: ["path"],
    additionalProperties: true,
  },
});
