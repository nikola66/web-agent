/**
 * Local TTS playback: browser `speechSynthesis` when available, else dev-server
 * `spd-say` on Linux (Chromium/Electron often has 0 voices and synthesis-failed).
 */

const SENTENCE_BOUNDARY_RE = /[.!?]["')\]]?\s+/;
const FLUSH_QUIET_MS = 600;
const MAX_BUFFER_CHARS = 240;
const MIN_SPEAK_CHARS = 4;
const LOCAL_TTS_MAX_CHARS = 2_500;
const ANSI_CSI_RE = /\x1B\[[0-9;?]*[A-Za-z]/g;
const ANSI_OSC_RE = /\x1B\][\s\S]*?(?:\x07|\x1B\\)/g;
const ANSI_OTHER_RE = /\x1B[=>()][\s\S]?|\x1B[78cDEMHN]/g;
const CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;
const ZERO_WIDTH_RE = /[​-‍﻿]/g;
const INTERNAL_MARKER_PAIR_RE = /<<<[A-Z_]+>>>[\s\S]*?<<<END[_A-Z]*>>>/g;
const INTERNAL_MARKER_TAIL_RE = /<<<[A-Z_]+>>>[\s\S]*$/g;
const TOOLCALL_RE = /<TOOLCALL>[\s\S]*?<\/TOOLCALL>/g;
const VOICE_DEBUG =
  typeof window !== "undefined" &&
  ((window as unknown as { __WEBAGENT_VOICE_DEBUG__?: boolean }).__WEBAGENT_VOICE_DEBUG__ ?? false);

export type VoicePlaybackBackend = "browser" | "local" | "none";

export type VoicePlaybackStatus = {
  backend: VoicePlaybackBackend;
  hint: string;
};

interface ProfileVoiceState {
  buffer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const profileState = new Map<string, ProfileVoiceState>();
const speakQueue: string[] = [];
let speaking = false;
let voicesPrimed = false;
let cachedBackend: VoicePlaybackBackend | null = null;
let backendProbe: Promise<VoicePlaybackBackend> | null = null;

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
      setTimeout(done, 2500);
    });
  }
  return voicesReadyPromise;
}

function browserSpeechLikelyWorks(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis && window.speechSynthesis.getVoices().length > 0;
}

async function probeLocalTts(): Promise<boolean> {
  try {
    const res = await fetch("/api/local-tts", { method: "GET" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

function testBrowserSpeak(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!browserSpeechLikelyWorks()) {
      resolve(false);
      return;
    }
    const synth = window.speechSynthesis!;
    nudgeSpeechSynthesis();
    const utterance = new SpeechSynthesisUtterance(".");
    utterance.volume = 0.01;
    utterance.rate = 2;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      synth.cancel();
      resolve(ok);
    };
    utterance.onstart = () => finish(true);
    utterance.onerror = () => finish(false);
    setTimeout(() => finish(false), 1500);
    synth.speak(utterance);
  });
}

/** Resolve which playback path works in this browser/host (cached). */
export async function resolveVoicePlaybackBackend(): Promise<VoicePlaybackBackend> {
  if (cachedBackend) return cachedBackend;
  if (!backendProbe) {
    backendProbe = (async () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        await ensureVoicesReady();
        if (browserSpeechLikelyWorks()) {
          const ok = await testBrowserSpeak();
          if (ok) {
            cachedBackend = "browser";
            return "browser";
          }
        }
      }
      if (await probeLocalTts()) {
        cachedBackend = "local";
        return "local";
      }
      cachedBackend = "none";
      return "none";
    })();
  }
  return backendProbe;
}

export function getVoicePlaybackStatus(backend: VoicePlaybackBackend): VoicePlaybackStatus {
  if (backend === "browser") {
    return { backend, hint: "Using browser speech (OS voices)." };
  }
  if (backend === "local") {
    return {
      backend,
      hint: "Browser speech unavailable — using local speech-dispatcher (dev server).",
    };
  }
  const onLinux = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent);
  return {
    backend: "none",
    hint: onLinux
      ? "Speech unavailable. Install speech-dispatcher + espeak-ng, or use Chrome with OS voices."
      : "Speech unavailable in this browser.",
  };
}

export function resetVoicePlaybackBackendCache(): void {
  cachedBackend = null;
  backendProbe = null;
  voicesPrimed = false;
}

export function primeVoiceEngine(): void {
  if (typeof window === "undefined" || !window.speechSynthesis || voicesPrimed) return;
  voicesPrimed = true;
  const synth = window.speechSynthesis;
  synth.getVoices();
  synth.addEventListener?.("voiceschanged", () => synth.getVoices(), { once: true });
  nudgeSpeechSynthesis();
}

async function speakViaLocalTts(text: string): Promise<boolean> {
  try {
    const res = await fetch("/api/local-tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, LOCAL_TTS_MAX_CHARS) }),
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

function speakViaBrowser(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!browserSpeechLikelyWorks()) {
      resolve(false);
      return;
    }
    nudgeSpeechSynthesis();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    if (VOICE_DEBUG) {
      utterance.addEventListener("start", () => console.debug("[voice] start", text.slice(0, 80)));
      utterance.addEventListener("error", (e) => console.debug("[voice] error", e));
      utterance.addEventListener("end", () => console.debug("[voice] end"));
      console.debug("[voice] speak", text.slice(0, 80));
    }
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    utterance.onstart = () => finish(true);
    utterance.onend = () => finish(true);
    utterance.onerror = () => finish(false);
    setTimeout(() => finish(false), Math.max(12_000, text.length * 80));
    window.speechSynthesis!.speak(utterance);
  });
}

async function playCleanText(text: string): Promise<void> {
  const clean = sanitize(text);
  if (!clean || clean.length < MIN_SPEAK_CHARS) {
    if (VOICE_DEBUG) console.debug("[voice] skip", { raw: text, clean });
    return;
  }
  const backend = await resolveVoicePlaybackBackend();
  if (backend === "browser") {
    if (await speakViaBrowser(clean)) return;
    resetVoicePlaybackBackendCache();
  }
  if ((await resolveVoicePlaybackBackend()) === "local") {
    await speakViaLocalTts(clean);
    return;
  }
  if (VOICE_DEBUG) console.debug("[voice] no backend available");
  window.dispatchEvent(
    new CustomEvent("webagent:voice-playback-unavailable", {
      detail: getVoicePlaybackStatus("none"),
    })
  );
}

function drainSpeakQueue(): void {
  if (speaking || speakQueue.length === 0) return;
  speaking = true;
  const text = speakQueue.shift()!;
  void playCleanText(text).finally(() => {
    speaking = false;
    drainSpeakQueue();
  });
}

function enqueueSpeak(text: string): void {
  speakQueue.push(text);
  drainSpeakQueue();
}

function speakChunk(text: string): void {
  enqueueSpeak(text);
}

export function speakConfirmation(text: string): void {
  if (typeof window === "undefined") return;
  primeVoiceEngine();
  void resolveVoicePlaybackBackend().then(() => enqueueSpeak(text));
}

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
  speakQueue.length = 0;
  speaking = false;
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
