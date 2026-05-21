# Voice

## Web app: playback and mic

- **Playback:** `src/core/voice-playback.ts` — Edge TTS (free cloud, Hermes-style) via `/api/edge-tts` → MP3 playback. Toggle with `/voice on|off` or the speaker control.
- **Mic:** `ChatInput` records via `MediaRecorder`; `src/core/voice/stt-client.ts` + `stt-worker.ts` run vendored **whisper-tiny.en** (~50 MB under `public/models/whisper-tiny-en/`).

## Telegram: inbound voice notes only

Replies are **text**. Outbound spoken audio is not supported on Telegram.

1. `mapInboundUpdate` surfaces voice messages.
2. `downloadTelegramVoice` pulls OGG/Opus via proxied `getFile` into `.webagent/voice-inbox/`.
3. The dispatcher transcribes with `audio_analyze` (Whisper over IPC) and prompts the agent with the transcript.

## Workspace / tool audio

`audio_analyze` transcribes paths under `uploads/` or `.webagent/voice-inbox/` via the same STT worker.

## Model files

Whisper STT — `public/models/whisper-tiny-en/`. Refresh: `npm run download:whisper`, then commit. Verified by `npm run check:models` before production builds.

## File map

- `telegram-voice.ts` — proxied getFile/download for inbound Telegram audio.
- `src/core/voice/stt-worker.ts`, `stt-client.ts`, `audio-decode.ts` — local STT.
- `audio-tools.ts` — `audio_analyze` built-in tool.
