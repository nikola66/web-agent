import { defineTool } from "../definition.js";
import { imageInfo } from "../filesystem/image-info.js";

export default defineTool({
  name: "image_info",
  run: imageInfo as unknown as (args: unknown, ctx: unknown) => Promise<unknown>,
  emoji: "🖼️",
  description:
    "Read dimensions and format from an image header without decoding pixels. " +
    "Supports PNG, JPEG, GIF, WebP, BMP. Required: `path` (workspace-relative). " +
    "For actual visual analysis use `vision_analyze`. " +
    "Returns { ok, path, bytes, format, width, height }.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative image file path." },
    },
    required: ["path"],
    additionalProperties: true,
  },
});
