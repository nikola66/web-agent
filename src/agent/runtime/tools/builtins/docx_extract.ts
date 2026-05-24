import { defineTool } from "../definition.js";
import { docxExtract } from "../filesystem/docx-extract.js";

export default defineTool({
  name: "docx_extract",
  run: docxExtract as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "📝",
  description:
    "Extract plain text from a .docx — try before `run_python` for simple text. Required: `path` (workspace-relative). " +
    "Optional: `max_chars` (default 500000). Paragraphs preserved; tables flattened to tab-separated rows. " +
    "Styles, images, and embeds are dropped — use this for the text content, not full fidelity. " +
    "Returns { ok, path, bytes, characters, text, truncated }.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative .docx path." },
      max_chars: { type: "number", description: "Cap on returned text characters (default 500000)." },
    },
    required: ["path"],
    additionalProperties: true,
  },
});
