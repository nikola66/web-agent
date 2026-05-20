import { defineTool } from "../definition.js";
import { audioAnalyzeTool } from "../audio-tools.js";

export default defineTool({
  name: "audio_analyze",
  run: audioAnalyzeTool,
  emoji: "🎙️",
  description:
    "Transcribe an audio file via local browser Whisper (whisper-tiny.en), then answer using the chat model. Pass `workspace_relative_audio_path` for files under `uploads/` or `.webagent/voice-inbox/`, `audio_data_url`, `audio_url`, or `fetch_url`. Custom `question` runs a text follow-up on the transcript.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "What to answer about the audio." },
      workspace_relative_audio_path: {
        type: "string",
        description: "Workspace-relative audio path under uploads/ or .webagent/voice-inbox/.",
      },
      audio_data_url: {
        type: "string",
        description: "data:audio/...;base64,... inline audio.",
      },
      audio_url: {
        type: "string",
        description: "data URL or https URL to an audio file.",
      },
      fetch_url: {
        type: "string",
        description: "If set, fetch this URL as the audio (when not using inline data).",
      },
    },
    additionalProperties: true,
  },
});
