import { defineTool } from "../definition.js";
import { artifactPresentTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "artifact_present",
  run: artifactPresentTool,
  emoji: "🪄",
  description: "Present a deliverable to the browser host (View / Download). Call as soon as a visual is ready when the user asked to see it. Inline: `title`, `filename` (.md), and `markdown` body — use for reports and remote images (`![alt](https://…)`). File: `title` and workspace-relative `path` for images, audio, video, PDF, DOCX, PPTX, markdown, or mermaid (.mmd). Provide exactly one of `markdown` or `path`.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
