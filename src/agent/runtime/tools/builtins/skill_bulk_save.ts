import { defineTool } from "../definition.js";
import { skillBulkSaveTool } from "../remote-tools.js";

export default defineTool({
  name: "skill_bulk_save",
  run: skillBulkSaveTool,
  emoji: "📚",
  description: "Batch save or import skills (one approval). Required: non-empty `items` array of `{ url }` (HTTPS raw SKILL.md) and/or `{ name, content, ... }` inline. For a single URL you may pass top-level `url` or `urls` (string[]) instead; optional `category` is applied to URL imports. Never set `url` together with `name` or `content` on the same item.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
  requiresConfirmation: true,
});
