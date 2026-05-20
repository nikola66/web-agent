# Voice (Telegram-side)

Voice support for the Telegram channel runs in the Nodebox runtime. The
browser mic transcribes locally via whisper-tiny.en; Telegram and workspace
audio files use the same STT worker through IPC.

## Inbound: local Whisper STT, then chat model

Voice files are transcribed in the browser via vendored **whisper-tiny.en**
(~50 MB q4f16 ONNX under `public/models/whisper-tiny-en/`). The agent's
normal chat model reads the transcript — no audio on `/chat/completions`.

The agent uses the `audio_analyze` tool, which sends audio bytes to the
adapter-hosted STT worker over IPC and returns the transcript (plus optional
text follow-up when `question` is customized).

**Telegram inbound flow**:

1. `mapInboundUpdate` surfaces voice messages instead of dropping them.
2. `downloadTelegramVoice` pulls the OGG/Opus bytes from Telegram's
   `getFile` URL into `.webagent/voice-inbox/<ts>-<id>.ogg`.
3. The dispatcher injects a synthetic user message naming the file path
   and instructing the agent to call `audio_analyze` with
   `workspace_relative_audio_path`.
4. `audio_analyze` transcribes via local Whisper; the agent replies from
   the transcript.

**Browser mic flow**:

1. `ChatInput`'s mic button records via `MediaRecorder` with 2.5 s timeslices.
2. Each slice is transcribed in a Web Worker; interim text appears while recording.
3. On stop, a final pass transcribes the full clip and submits the text directly
   to the agent (no WAV upload, no `audio_analyze` round-trip).

Works with any LLM provider — STT is fully local.

## Outbound: Kokoro-82M TTS, shipped

When a Telegram chat has voice mode on and the agent finalises a reply,
the runtime synthesises an MP3 locally and sends it back as a Telegram
audio attachment.

**Pipeline** (see `synthesize.ts`):

1. `kokoro-js` `KokoroTTS.from_pretrained(...)` loads the mirrored
   Kokoro-82M model (`q8f16` dtype, ~85 MB) from `${webagentDir}/models/
   onnx-community/Kokoro-82M-v1.0-ONNX/`.
2. `pipeline.generate(text, { voice: "af_bella" })` returns Float32 PCM at
   24 kHz.
3. Linear resample to 16 kHz mono.
4. `@breezystack/lamejs` `Mp3Encoder` (mono, 16 kHz, 48 kbps) emits MP3
   bytes.
5. `sendTelegramAudio` POSTs to Telegram's `/sendAudio` endpoint as
   `audio/mpeg`.

## Model files

**STT** — tracked in git under `public/models/whisper-tiny-en/`. Refresh:
`npm run download:whisper`, then commit.

**TTS** — tracked in git under
`public/models/onnx-community/Kokoro-82M-v1.0-ONNX/` (~85 MB). Production
builds verify both trees via `npm run check:models` (chained into
`npm run build`). At workspace boot, Kokoro is mirrored into the Nodebox FS;
Whisper loads from the browser page origin. `env.allowRemoteModels = false`
is enforced; no HuggingFace traffic at runtime.

## Debug events

`telegram_voice_received`, `telegram_voice_downloaded`, `voice_synthesized`,
`telegram_voice_reply_sent`, `telegram_voice_reply_failed`,
`telegram_sendAudio_failed`.

## File map

- `telegram-voice.ts` — getFile/download, sendAudio, per-chat flag store.
- `synthesize.ts` — Kokoro TTS + lamejs MP3 encoder.
- `src/core/voice/stt-worker.ts` — Whisper WASM worker.
- `src/core/voice/stt-client.ts` — main-thread STT client + prefetch.
- `src/core/voice/audio-decode.ts` — decode/resample to 16 kHz mono.

`audio_analyze` lives in `src/agent/runtime/tools/audio-tools.ts` alongside
the other built-in tools.
