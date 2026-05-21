import type { Profile } from "@/core/profiles";

export const DEFAULT_EDGE_TTS_VOICE = "en-US-AvaNeural";
/** Edge TTS rate adjustment; +25% ≈ 1.25× normal speed. */
export const DEFAULT_EDGE_TTS_RATE = "+25%";
export const EDGE_TTS_LOCALE_LABEL = "US English";

export interface EdgeTtsVoiceOption {
  id: string;
  label: string;
  gender: string;
  locale: string;
}

export function formatEdgeTtsVoiceOption(v: EdgeTtsVoiceOption): string {
  const gender = v.gender ? ` · ${v.gender}` : "";
  return `${v.label}${gender}`;
}

export function voiceDisplayNameFromId(voiceId: string): string {
  return voiceId.replace(/^en-US-/, "").replace(/Neural.*$/i, "").replace(/Multilingual/i, "") || "Ava";
}

export function resolveProfileTtsVoice(profile?: Pick<Profile, "ttsVoice"> | null): string {
  const v = profile?.ttsVoice?.trim();
  if (v && /^en-US-[A-Za-z0-9-]+$/.test(v)) return v;
  return DEFAULT_EDGE_TTS_VOICE;
}

let voicesCache: EdgeTtsVoiceOption[] | null = null;
let voicesPromise: Promise<EdgeTtsVoiceOption[]> | null = null;

export async function fetchEdgeTtsVoices(): Promise<EdgeTtsVoiceOption[]> {
  if (voicesCache) return voicesCache;
  if (!voicesPromise) {
    voicesPromise = fetch("/api/edge-tts/voices")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Voice list unavailable (${res.status})`);
        const data = (await res.json()) as EdgeTtsVoiceOption[];
        voicesCache = data;
        return data;
      })
      .finally(() => {
        voicesPromise = null;
      });
  }
  return voicesPromise;
}

export function resetEdgeTtsVoicesCache(): void {
  voicesCache = null;
}
