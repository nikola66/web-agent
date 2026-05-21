/**
 * Voice-mode toggle.
 *
 * State is global (not per-profile) and persisted in localStorage so the
 * preference survives reloads. Two surfaces drive this store:
 *   - the bottom-right toggle button in `StatusBar`
 *   - the `/voice [on|off]` slash command
 *
 * When `enabled === true`, the orchestrator pipes finalised assistant text
 * to Edge TTS via `/api/edge-tts` for spoken playback. Mic input uses local
 * Whisper STT; Telegram voice uses the same STT path via `audio_analyze`.
 */

import { create } from "zustand";

const STORAGE_KEY = "webagent.voice.enabled";

function readInitialEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistEnabled(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode etc. — silent */
  }
}

export interface VoiceState {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
}

export const useVoiceStore = create<VoiceState>()((set, get) => ({
  enabled: readInitialEnabled(),
  setEnabled: (next) => {
    persistEnabled(next);
    set({ enabled: next });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("webagent:voice-mode-changed", { detail: { enabled: next } }));
    }
  },
  toggle: () => get().setEnabled(!get().enabled),
}));

/** Imperative read for non-React modules (orchestrator hook, slash-command handler). */
export function isVoiceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return useVoiceStore.getState().enabled;
}
