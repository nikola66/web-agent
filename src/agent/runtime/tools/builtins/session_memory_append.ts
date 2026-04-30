import { defineTool } from "../definition.js";
import { sessionMemoryRememberTool } from "../remote-tools.js";

export default defineTool({
  name: "session_memory_append",
  run: sessionMemoryRememberTool,
  emoji: "📝",
  description: "Append a lightweight note to rolling session memory (JSONL under `.webagent/`). Useful for sticky decisions across turns. Kind: decision | note | artifact.",
  inputSchema: { type: "object", properties: { kind: { type: "string", description: "note | decision | artifact" }, text: { type: "string" }, ref: { type: "string", description: "Optional short reference token." }, artifact_path: { type: "string", description: "Optional workspace file path cited." } }, required: ["text"], additionalProperties: false },
});
