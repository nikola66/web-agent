import { defineTool } from "../definition.js";
import { youtubeTranscribeTool } from "../remote-tools.js";

export default defineTool({
  name: "youtube_transcribe",
  run: youtubeTranscribeTool,
  emoji: "📹",
  description: "Fetch and return the full transcript/captions of a YouTube video by URL. Returns text with timestamps. Useful for understanding video content without watching.",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
