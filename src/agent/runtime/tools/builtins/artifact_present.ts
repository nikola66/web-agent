import { defineTool } from "../definition.js";
import { artifactPresentTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "artifact_present",
  run: artifactPresentTool,
  emoji: "🪄",
  description: "Present markdown to the browser host: opens a View / Download affordance for plans, articles, or specs. Pass `title`, `filename` (.md), and `markdown` body.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
