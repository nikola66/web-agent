import { defineTool } from "../definition.js";
import { visionAnalyzeTool } from "../vision-tools.js";

export default defineTool({
  name: "vision_analyze",
  run: visionAnalyzeTool,
  emoji: "🖼️",
  description: "Analyze an image via the configured OpenAI-compatible vision model (`/chat/completions` + `image_url`). Pass `workspace_relative_image_path` for an image under `uploads/`, `image_data_url` (data:image/png;base64,...), https URL to an image, or `fetch_url`; include `question` for what to extract. Uses WEBAGENT_VISION_MODEL when the default chat model is not multimodal.",
  inputSchema: { type: "object", properties: { question: { type: "string", description: "What to answer about the image." }, workspace_relative_image_path: { type: "string", description: "Workspace-relative image path under uploads/." }, image_data_url: { type: "string", description: "data:image/...;base64,... inline image." }, image_url: { type: "string", description: "data URL or https URL to a raster image." }, fetch_url: { type: "string", description: "If set, fetch this URL as the image (when not using inline data)." }, model_override: { type: "string", description: "Optional vision model id for this call only." } }, additionalProperties: true },
});
