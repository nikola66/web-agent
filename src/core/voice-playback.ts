/**
 * Local TTS playback via the browser's built-in `speechSynthesis` API.
 *
 * `speechSynthesis` uses the operating-system voice catalog (macOS Speech,
 * Windows SAPI, espeak on Linux). No network round-trip — meets the
 * "nothing outside the repo" constraint.
 *
 * Assistant text arrives as small streaming chunks. We buffer per profile
 * until we hit a sentence boundary (or the stream goes quiet for a moment)
 * and only then enqueue an utterance — keeps prosody natural and avoids
 * one-syllable-per-utterance choppiness.
 */

const SENTENCE_BOUNDARY_RE = /[.!?]["')\]]?\s+/;
const FLUSH_QUIET_MS = 600;
const MAX_BUFFER_CHARS = 240;
const MIN_SPEAK_CHARS = 4;
/** Strip control sequences (ANSI + xterm OSC/DCS) and obvious internal markers before speaking. */
const ANSI_CSI_RE = /\x1B\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC_RE = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const ANSI_OTHER_RE = /\x1B[=>()][\s\S]?|\x1B[78cDEMHN]/g;
const CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;
const ZERO_WIDTH_RE = /[​-‍﻿]/g;
/** Match a closed marker pair (cheap full-strip) or a dangling opener (drop everything from `<<<X>>>` onward). */
const INTERNAL_MARKER_PAIR_RE = /<<<[A-Z_]+>>>[\s\S]*?<<<END[_A-Z]*>>>/g;
const INTERNAL_MARKER_TAIL_RE = /<<<[A-Z_]+>>>[\s\S]*$/g;
const TOOLCALL_RE = /<TOOLCALL>[\s\S]*?<\/TOOLCALL>/g;
const VOICE_DEBUG =
  typeof window !== "undefined" &&
  ((window as unknown as { __WEBAGENT_VOICE_DEBUG__?: boolean }).__WEBAGENT_VOICE_DEBUG__ ?? false);

interface ProfileVoiceState {
  buffer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const profileState = new Map<string, ProfileVoiceState>();

function getState(profileId: string): ProfileVoiceState {
  let entry = profileState.get(profileId);
  if (!entry) {
    entry = { buffer: "", flushTimer: null };
    profileState.set(profileId, entry);
  }
  return entry;
}

function sanitize(text: string): string {
  return text
    .replace(INTERNAL_MARKER_PAIR_RE, "")
    .replace(INTERNAL_MARKER_TAIL_RE, "")
    .replace(TOOLCALL_RE, "")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_OTHER_RE, "")
    .replace(CONTROL_CHARS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_~#>]+/g, "")
    .replace(/^\s*[•·▸▶✓✗→\-]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chrome bug workaround: long utterances and idle queues silently stall. */
function nudgeSpeechSynthesis(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const synth = window.speechSynthesis;
  if (synth.paused) {
    try {
      synth.resume();
    } catch {
      /* ignore */
    }
  }
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred =
    voices.find((v) => v.default && v.lang?.toLowerCase().startsWith("en")) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    voices.find((v) => v.default) ||
    voices[0];
  return preferred ?? null;
}

let voicesReadyPromise: Promise<void> | null = null;

function ensureVoicesReady(): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
  if (window.speechSynthesis.getVoices().length > 0) return Promise.resolve();
  if (!voicesReadyPromise) {
    voicesReadyPromise = new Promise((resolve) => {
      const synth = window.speechSynthesis!;
      const done = () => {
        voicesReadyPromise = null;
        resolve();
      };
      synth.addEventListener("voiceschanged", done, { once: true });
      synth.getVoices();
      setTimeout(done, 2000);
    });
  }
  return voicesReadyPromise;
}

function speakChunkNow(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = sanitize(text);
  if (!clean || clean.length < MIN_SPEAK_CHARS) {
    if (VOICE_DEBUG) console.debug("[voice] skip (too short / empty after sanitize)", { raw: text, clean });
    return;
  }
  nudgeSpeechSynthesis();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.rate = 1.05;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  if (VOICE_DEBUG) {
    utterance.addEventListener("start", () => console.debug("[voice] start", clean.slice(0, 80)));
    utterance.addEventListener("error", (e) => console.debug("[voice] error", e));
    utterance.addEventListener("end", () => console.debug("[voice] end"));
    console.debug("[voice] speak", clean.slice(0, 80));
  }
  window.speechSynthesis.speak(utterance);
}

function speakChunk(text: string): void {
  void ensureVoicesReady().then(() => speakChunkNow(text));
}

/**
 * Preload OS voices and prime the engine. SpeechSynthesis returns an empty
 * voice list on first call in Chrome until `voiceschanged` fires; without
 * a voice, the first utterance is sometimes silently dropped.
 */
let voicesPrimed = false;
export function primeVoiceEngine(): void {
  if (typeof window === "undefined" || !window.speechSynthesis || voicesPrimed) return;
  voicesPrimed = true;
  const synth = window.speechSynthesis;
  synth.getVoices();
  synth.addEventListener?.("voiceschanged", () => synth.getVoices(), { once: true });
  nudgeSpeechSynthesis();
}

/** Speak a one-shot confirmation utterance (used when the user toggles voice ON). */
export function speakConfirmation(text: string): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  primeVoiceEngine();
  void ensureVoicesReady().then(() => {
    nudgeSpeechSynthesis();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis!.speak(utterance);
  });
}

/**
 * Hand a streamed-output chunk to the voice player. No-op when the chunk
 * is empty or when voice mode is disabled by the time the flush fires.
 *
 * The `isEnabled` callback is injected so this module does not import the
 * Zustand store directly (keeps it usable from non-React code paths).
 */
export function pushVoiceChunk(
  profileId: string,
  chunk: string,
  isEnabled: () => boolean
): void {
  if (!chunk || !isEnabled()) return;
  const state = getState(profileId);
  state.buffer += chunk;

  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }

  while (true) {
    const match = SENTENCE_BOUNDARY_RE.exec(state.buffer);
    if (!match) break;
    const cut = match.index + match[0].length;
    const sentence = state.buffer.slice(0, cut);
    state.buffer = state.buffer.slice(cut);
    speakChunk(sentence);
  }

  let nlIdx = state.buffer.indexOf("\n");
  while (nlIdx >= 0) {
    const line = state.buffer.slice(0, nlIdx + 1);
    state.buffer = state.buffer.slice(nlIdx + 1);
    speakChunk(line);
    nlIdx = state.buffer.indexOf("\n");
  }

  if (state.buffer.length >= MAX_BUFFER_CHARS) {
    speakChunk(state.buffer);
    state.buffer = "";
    return;
  }

  if (state.buffer.trim().length > 0) {
    state.flushTimer = setTimeout(() => {
      const current = getState(profileId);
      if (!isEnabled()) {
        current.buffer = "";
        current.flushTimer = null;
        return;
      }
      if (current.buffer.trim().length > 0) {
        speakChunk(current.buffer);
        current.buffer = "";
      }
      current.flushTimer = null;
    }, FLUSH_QUIET_MS);
  }
}

/** Speak any buffered text immediately (e.g. when the agent turn finishes). */
export function flushVoiceBuffer(
  profileId: string,
  isEnabled: () => boolean = () => true
): void {
  const state = getState(profileId);
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  if (!isEnabled()) {
    state.buffer = "";
    return;
  }
  if (state.buffer.trim().length > 0) {
    speakChunk(state.buffer);
    state.buffer = "";
  }
}

export function cancelVoicePlayback(profileId?: string): void {
  if (typeof window === "undefined") return;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (profileId) {
    const state = profileState.get(profileId);
    if (state?.flushTimer) clearTimeout(state.flushTimer);
    if (state) {
      state.buffer = "";
      state.flushTimer = null;
    }
  } else {
    for (const state of profileState.values()) {
      if (state.flushTimer) clearTimeout(state.flushTimer);
      state.buffer = "";
      state.flushTimer = null;
    }
    profileState.clear();
  }
}
