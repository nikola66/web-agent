import { defineTool } from "../definition.js";
import { sessionMemoryRememberTool } from "../remote-tools.js";

const SESSION_MEMORY_APPEND_EXAMPLES = [
  { kind: "note", text: "Outreach plan draft lives under projects/ainex-sales-outreach/" },
  { kind: "artifact", text: "Plan file", artifact_path: "projects/ainex-sales-outreach/outreach_plan.md" },
];

export default defineTool({
  name: "session_memory_append",
  run: sessionMemoryRememberTool,
  emoji: "📝",
  description:
    "Append rolling session notes (`.webagent/session-memory.jsonl`). Required: `text`. " +
    "Optional `kind` (note | decision | artifact), `ref`, `artifact_path`. " +
    "Not for durable preferences — use `memory_save`. Example: " +
    JSON.stringify(SESSION_MEMORY_APPEND_EXAMPLES[0]),
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", description: "note | decision | artifact" },
      text: { type: "string", description: "Note body (required)." },
      ref: { type: "string", description: "Optional short reference token." },
      artifact_path: {
        type: "string",
        description: "Optional workspace-relative file path.",
      },
    },
    required: ["text"],
    additionalProperties: false,
    examples: SESSION_MEMORY_APPEND_EXAMPLES,
  },
});
