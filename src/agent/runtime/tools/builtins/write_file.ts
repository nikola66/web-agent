import { defineTool } from "../definition.js";
import { writeFileTool } from "../filesystem-tools.js";
import { WRITE_FILE_MAX_BYTES } from "../write-file-args.js";

const maxMiB = (WRITE_FILE_MAX_BYTES / (1024 * 1024)).toFixed(0);

export default defineTool({
  name: "write_file",
  run: writeFileTool,
  emoji: "✍️",
  description:
    `Write a text file (up to ${maxMiB} MiB). One JSON object: path + content strings via native tool_calls (no markdown fence). ` +
    "For long articles use append:true on follow-up calls with the next section, or run_python. " +
    "Aliases: contents/text/markdown/body→content; file/filename→path.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative file path (e.g. projects/blog/article.md).",
      },
      content: {
        type: "string",
        maxLength: WRITE_FILE_MAX_BYTES,
        description: "Full file contents as a single JSON string (escape newlines as \\n).",
      },
      append: {
        type: "boolean",
        description: "When true, append content to an existing file instead of replacing it.",
      },
    },
    required: ["path", "content"],
    additionalProperties: true,
    examples: [
      {
        path: "projects/flex-on-the-block/bitnet-1bit-llm.md",
        content: "# BitNet and 1-bit LLMs\\n\\nOpening paragraph...",
      },
    ],
  },
});
