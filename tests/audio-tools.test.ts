import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VOICE_QUESTION,
  audioAnalyzeTool,
  isDefaultVoiceQuestion,
} from "../dist/agent-runtime/tools/audio-tools.js";

test("isDefaultVoiceQuestion matches the built-in voice prompt", () => {
  assert.equal(isDefaultVoiceQuestion(DEFAULT_VOICE_QUESTION), true);
  assert.equal(isDefaultVoiceQuestion("Summarize the speaker's tone."), false);
});

test("audio_analyze rejects missing audio payloads", async () => {
  await assert.rejects(
    audioAnalyzeTool({ question: "What did they say?" }, { env: process.env }),
    /workspace_relative_audio_path|audio_data_url|audio_url|fetch_url/
  );
});

test("audio_analyze rejects workspace audio paths outside allowed roots", async () => {
  await assert.rejects(
    audioAnalyzeTool(
      { workspace_relative_audio_path: "notes/clip.ogg" },
      { env: process.env, cwd: process.cwd() }
    ),
    /uploads\/|voice-inbox/
  );
});

test("audio_analyze rejects conflicting audio source arguments", async () => {
  await assert.rejects(
    audioAnalyzeTool(
      {
        workspace_relative_audio_path: "uploads/a.wav",
        audio_url: "data:audio/wav;base64,abc",
      },
      { env: process.env, cwd: process.cwd() }
    ),
    /not both/
  );
});

test("audio_analyze rejects missing workspace files before STT IPC", async () => {
  await assert.rejects(
    audioAnalyzeTool(
      { workspace_relative_audio_path: "uploads/missing-voice.wav" },
      { env: process.env, cwd: process.cwd() }
    ),
    /not found/
  );
});

test("audio_analyze rejects missing workspace files before LLM follow-up", async () => {
  await assert.rejects(
    audioAnalyzeTool(
      {
        workspace_relative_audio_path: "uploads/missing-custom.wav",
        question: "Summarize the speaker's tone.",
      },
      { env: process.env, cwd: process.cwd() }
    ),
    /not found/
  );
});
