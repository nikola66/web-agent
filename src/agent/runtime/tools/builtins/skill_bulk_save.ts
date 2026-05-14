import { defineTool } from "../definition.js";
import { skillBulkSaveTool } from "../remote-tools.js";

const SKILL_BULK_EXAMPLES = [
  {
    items: [
      {
        name: "demo_skill",
        content: "---\nname: demo\n---\nBody",
        description: "Example",
      },
    ],
  },
  { url: "https://example.com/raw/SKILL.md" },
  { urls: ["https://a.example/SKILL.md", "https://b.example/SKILL.md"], category: "playbooks" },
];

export default defineTool({
  name: "skill_bulk_save",
  run: skillBulkSaveTool,
  emoji: "📚",
  description:
    "Use for HTTPS SKILL.md installs (including GitHub); do not use run_shell or npx to install skills. GitHub blob links are accepted (server normalizes to raw). Batch save or import (one approval). Required: non-empty `items` of `{ url }` (HTTPS SKILL.md) and/or `{ name, content, ... }` inline, or top-level `url` or `urls` (string[]) instead; optional `category` for URL imports. Never set `url` together with `name` or `content` on the same item. Examples (arguments JSON only): " +
    JSON.stringify(SKILL_BULK_EXAMPLES[0]) +
    " | " +
    JSON.stringify(SKILL_BULK_EXAMPLES[1]) +
    " | " +
    JSON.stringify(SKILL_BULK_EXAMPLES[2]),
  inputSchema: {
    type: "object",
    properties: {
      items: { type: "array", description: "Inline or URL-backed skill rows." },
      url: { type: "string", description: "Single HTTPS SKILL.md URL." },
      urls: { type: "array", items: { type: "string" }, description: "Multiple HTTPS URLs." },
      category: { type: "string", description: "Optional category for URL imports." },
    },
    required: [],
    additionalProperties: true,
    examples: SKILL_BULK_EXAMPLES,
  },
  requiresConfirmation: true,
});
