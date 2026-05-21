import { EdgeTTS } from "edge-tts-universal";

export const DEFAULT_EDGE_TTS_VOICE = "en-US-AvaNeural";
export const DEFAULT_EDGE_TTS_RATE = "+25%";
export const EDGE_TTS_MAX_CHARS = 5000;

export function normalizeEnUsVoice(voice) {
  const v = String(voice ?? DEFAULT_EDGE_TTS_VOICE).trim();
  if (/^en-US-[A-Za-z0-9-]+$/.test(v)) return v;
  return DEFAULT_EDGE_TTS_VOICE;
}

export function normalizeEdgeTtsRate(rate) {
  const r = String(rate ?? DEFAULT_EDGE_TTS_RATE).trim();
  if (/^[+-]?\d+(\.\d+)?%$/.test(r)) return r;
  return DEFAULT_EDGE_TTS_RATE;
}

export async function synthesizeEdgeMp3(text, voice = DEFAULT_EDGE_TTS_VOICE, rate = DEFAULT_EDGE_TTS_RATE) {
  const trimmed = String(text ?? "").trim().slice(0, EDGE_TTS_MAX_CHARS);
  if (!trimmed) throw new Error("empty text");
  const tts = new EdgeTTS(trimmed, normalizeEnUsVoice(voice), {
    rate: normalizeEdgeTtsRate(rate),
  });
  const result = await tts.synthesize();
  return Buffer.from(await result.audio.arrayBuffer());
}
