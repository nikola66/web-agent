import { defineTool } from "../definition.js";
import { artifactPresentTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "artifact_present",
  run: artifactPresentTool,
  emoji: "🪄",
  description: "Present a deliverable to the browser host (View / Download). Call as soon as a visual is ready when the user asked to see it. Inline: `title`, `filename` (.md), and `markdown` body — use for reports and remote images (`![alt](https://…)`). File: `title` and workspace-relative `path` for images, audio, video, PDF, DOCX, PPTX, markdown, or mermaid (.mmd). Provide exactly one of `markdown` or `path`.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Deliverable title shown to the user." },
      path: {
        type: "string",
        description: "Workspace-relative file (image/audio/video/PDF/DOCX/PPTX/markdown/.mmd). Provide this OR `markdown`.",
      },
      markdown: { type: "string", description: "Inline markdown body. Provide this OR `path`." },
      filename: { type: "string", description: "Filename for inline markdown (.md). Default artifact.md." },
      kind: { type: "string", description: "Optional artifact kind hint." },
    },
    additionalProperties: true,
  },
});
