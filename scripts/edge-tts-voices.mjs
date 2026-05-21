import { listVoices } from "edge-tts-universal";

export const EDGE_TTS_LOCALE = "en-US";

export function voiceDisplayName(shortName) {
  const id = String(shortName || "");
  const core = id.replace(/^en-US-/, "").replace(/Neural$/i, "").replace(/Multilingual/i, "");
  return core || id;
}

export async function listEnUsVoices() {
  const voices = await listVoices();
  return voices
    .filter((v) => String(v.Locale || "").startsWith(EDGE_TTS_LOCALE))
    .map((v) => ({
      id: String(v.ShortName || ""),
      gender: String(v.Gender || ""),
      locale: String(v.Locale || EDGE_TTS_LOCALE),
      label: voiceDisplayName(v.ShortName),
    }))
    .filter((v) => v.id)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}
