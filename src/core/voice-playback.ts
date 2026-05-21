/**
 * Edge TTS playback: same-origin /api/edge-tts proxy → MP3 → HTMLAudioElement.
 * Free Microsoft neural voices (Hermes-style); no API key.
 */

import { useProfileStore } from "@/ui/stores/profile-store";
import {
  DEFAULT_EDGE_TTS_RATE,
  DEFAULT_EDGE_TTS_VOICE,
  resolveProfileTtsVoice,
  voiceDisplayNameFromId,
} from "./voice/edge-tts-client";

const SENTENCE_BOUNDARY_RE = /[.!?]["')\]]?\s+/;
const FLUSH_QUIET_MS = 600;
const MAX_BUFFER_CHARS = 240;
const MIN_SPEAK_CHARS = 4;
const EDGE_TTS_MAX_CHARS = 5000;
const EDGE_TTS_PATH = "/api/edge-tts";
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

export type VoicePlaybackBackend = "edge" | "none";

export type VoicePlaybackActivity = "idle" | "loading" | "playing";

export type VoicePlaybackStatus = {
  backend: VoicePlaybackBackend;
  hint: string;
};

interface ProfileVoiceState {
  buffer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const agentNarrationEnabled = new Set<string>();
/** Wait for ` ⎿ ` assistant branch, then narrate until the next system line. */
type AgentVoicePhase = "pre_agent" | "awaiting_branch" | "narrating";
const agentVoicePhase = new Map<string, AgentVoicePhase>();
const voiceLineCarry = new Map<string, string>();

export const BOOT_PROMO_TEXT =
  "Thanks for using Web Agent! If this project helps you, a star on GitHub means a lot — every star counts. Find us at github.com slash nikola66 slash web-agent.";

function plainVoiceText(text: string): string {
  return text
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_OTHER_RE, "")
    .replace(CONTROL_CHARS_RE, "");
}

function isBannerOrMetaLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^[█▓░─━=\s]+$/.test(t)) return true;
  if (/^(🫡|🧠|🛠️|⌨️)/.test(t)) return true;
  if (/\bProfile:/i.test(t)) return true;
  if (/\bModel:/i.test(t)) return true;
  if (/\bSandbox:/i.test(t)) return true;
  if (/\bCommands:/i.test(t)) return true;
  if (/tools armed/i.test(t)) return true;
  if (/openrouter|nodebox/i.test(t) && t.length < 120) return true;
  return false;
}

function isNonNarratableVoiceLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isBannerOrMetaLine(line)) return true;
  if (/^[▸▶✓✗⚠🫀❯]/.test(t)) return true;
  if (/\bstopped:/i.test(t)) return true;
  if (/\bheartbeat:/i.test(t)) return true;
  if (/self-improvement review:/i.test(t)) return true;
  if (/curator:/i.test(t)) return true;
  if (/no cron jobs/i.test(t)) return true;
  if (/heartbeat done/i.test(t)) return true;
  if (/^tool guardrail/i.test(t)) return true;
  if (/^skipped \d+ invalid tool/i.test(t)) return true;
  if (/^(Booting|Checking|Restoring|Preparing|Starting Web Agent)/i.test(t)) return true;
  if (/^restored \d+ file/i.test(t)) return true;
  if (/Credentials restored/i.test(t)) return true;
  if (/^First run can take/i.test(t)) return true;
  if (/^cron '/i.test(t)) return true;
  if (/heartbeat error/i.test(t)) return true;
  return false;
}

function setAgentVoicePhase(profileId: string, phase: AgentVoicePhase): void {
  agentVoicePhase.set(profileId, phase);
}

function extractNarratableAgentText(profileId: string, chunk: string): string {
  const carry = voiceLineCarry.get(profileId) ?? "";
  const combined = carry + plainVoiceText(chunk);
  const parts = combined.split(/\r?\n/);
  voiceLineCarry.set(profileId, parts.pop() ?? "");

  const out: string[] = [];
  for (const line of parts) {
    if (isNonNarratableVoiceLine(line)) {
      setAgentVoicePhase(profileId, "awaiting_branch");
      continue;
    }

    const branchMatch = line.match(/^\s*⎿\s?(.*)$/);
    if (branchMatch) {
      setAgentVoicePhase(profileId, "narrating");
      const text = branchMatch[1]?.trim();
      if (text) out.push(text);
      continue;
    }

    const phase = agentVoicePhase.get(profileId) ?? "pre_agent";
    if (phase === "narrating" && line.trim()) {
      out.push(line.trim());
    }
  }

  return out.join("\n");
}

export function setAgentVoiceNarration(profileId: string, enabled: boolean): void {
  if (enabled) {
    agentNarrationEnabled.add(profileId);
    setAgentVoicePhase(profileId, "pre_agent");
  } else {
    agentNarrationEnabled.delete(profileId);
    agentVoicePhase.delete(profileId);
    voiceLineCarry.delete(profileId);
  }
}

export function markAgentVoiceTurnStart(profileId: string): void {
  if (agentNarrationEnabled.has(profileId)) {
    setAgentVoicePhase(profileId, "awaiting_branch");
  }
}

export function flushAgentVoiceLineCarry(
  profileId: string,
  isEnabled: () => boolean
): void {
  const pending = voiceLineCarry.get(profileId);
  voiceLineCarry.delete(profileId);
  if (!pending?.trim() || !agentNarrationEnabled.has(profileId) || !isEnabled()) return;
  if (agentVoicePhase.get(profileId) !== "narrating") return;
  const branchMatch = pending.match(/^\s*⎿\s?(.*)$/);
  if (branchMatch) {
    if (branchMatch[1]?.trim()) pushVoiceChunk(profileId, branchMatch[1], isEnabled);
    return;
  }
  if (!isNonNarratableVoiceLine(pending) && pending.trim()) {
    pushVoiceChunk(profileId, pending.trim(), isEnabled);
  }
}

export function speakBootPromo(): void {
  speakConfirmation(BOOT_PROMO_TEXT);
}

export function pushAgentVoiceChunk(
  profileId: string,
  chunk: string,
  isEnabled: () => boolean
): void {
  if (!agentNarrationEnabled.has(profileId) || !chunk || !isEnabled()) return;
  const filtered = extractNarratableAgentText(profileId, chunk);
  if (!filtered.trim()) return;
  pushVoiceChunk(profileId, filtered, isEnabled);
}

const profileState = new Map<string, ProfileVoiceState>();
interface SpeakJob {
  text: string;
  voice: string;
}
const speakQueue: SpeakJob[] = [];
let speaking = false;
let cachedBackend: VoicePlaybackBackend | null = null;
let backendProbe: Promise<VoicePlaybackBackend> | null = null;
let currentAudio: HTMLAudioElement | null = null;
let currentBlobUrl: string | null = null;
let voiceActivity: VoicePlaybackActivity = "idle";
const voiceActivityListeners = new Set<(activity: VoicePlaybackActivity) => void>();

function setVoiceActivity(next: VoicePlaybackActivity): void {
  if (voiceActivity === next) return;
  voiceActivity = next;
  for (const listener of voiceActivityListeners) listener(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("webagent:voice-playback-activity", { detail: { activity: next } })
    );
  }
}

function refreshVoiceActivity(): void {
  if (currentAudio && !currentAudio.paused && !currentAudio.ended) {
    setVoiceActivity("playing");
    return;
  }
  if (speaking || speakQueue.length > 0) {
    setVoiceActivity("loading");
    return;
  }
  setVoiceActivity("idle");
}

export function getVoicePlaybackActivity(): VoicePlaybackActivity {
  return voiceActivity;
}

export function subscribeVoicePlaybackActivity(
  listener: (activity: VoicePlaybackActivity) => void
): () => void {
  voiceActivityListeners.add(listener);
  listener(voiceActivity);
  return () => voiceActivityListeners.delete(listener);
}

function voiceForProfile(profileId: string): string {
  const profile = useProfileStore.getState().profiles.find((p) => p.id === profileId);
  return resolveProfileTtsVoice(profile);
}

function voiceForActiveProfile(): string {
  const { profiles, activeProfileId } = useProfileStore.getState();
  const profile = profiles.find((p) => p.id === activeProfileId);
  return resolveProfileTtsVoice(profile);
}

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

async function probeEdgeTts(): Promise<boolean> {
  try {
    const res = await fetch(EDGE_TTS_PATH, { method: "GET" });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

/** Resolve which playback path works in this browser/host (cached). */
export async function resolveVoicePlaybackBackend(): Promise<VoicePlaybackBackend> {
  if (cachedBackend) return cachedBackend;
  if (!backendProbe) {
    backendProbe = (async () => {
      if (await probeEdgeTts()) {
        cachedBackend = "edge";
        return "edge";
      }
      cachedBackend = "none";
      return "none";
    })();
  }
  return backendProbe;
}

export function getVoicePlaybackStatus(
  backend: VoicePlaybackBackend,
  voiceId: string = DEFAULT_EDGE_TTS_VOICE
): VoicePlaybackStatus {
  if (backend === "edge") {
    const name = voiceDisplayNameFromId(voiceId);
    return { backend, hint: `Using Edge TTS (${name}, US English).` };
  }
  return {
    backend: "none",
    hint: "Edge TTS unavailable. Run with npm run dev or the production sidecar (scripts/start-with-proxy.sh).",
  };
}

export function resetVoicePlaybackBackendCache(): void {
  cachedBackend = null;
  backendProbe = null;
}

function stopCurrentAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }
  refreshVoiceActivity();
}

async function speakViaEdgeTts(text: string, voice: string): Promise<boolean> {
  try {
    const res = await fetch(EDGE_TTS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: text.slice(0, EDGE_TTS_MAX_CHARS),
        voice,
        rate: DEFAULT_EDGE_TTS_RATE,
      }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;

    stopCurrentAudio();
    const url = URL.createObjectURL(blob);
    currentBlobUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (currentAudio === audio) {
          currentAudio = null;
          if (currentBlobUrl === url) {
            URL.revokeObjectURL(url);
            currentBlobUrl = null;
          }
        }
        refreshVoiceActivity();
        resolve(ok);
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.onplaying = () => setVoiceActivity("playing");
      setTimeout(() => finish(false), Math.max(30_000, text.length * 120));
      if (VOICE_DEBUG) console.debug("[voice] edge play", text.slice(0, 80));
      setVoiceActivity("loading");
      void audio.play().catch(() => finish(false));
    });
  } catch {
    refreshVoiceActivity();
    return false;
  }
}

async function playCleanText(text: string, voice: string): Promise<void> {
  const clean = sanitize(text);
  if (!clean || clean.length < MIN_SPEAK_CHARS || isNonNarratableVoiceLine(clean)) {
    if (VOICE_DEBUG) console.debug("[voice] skip", { raw: text, clean });
    return;
  }
  setVoiceActivity("loading");
  const backend = await resolveVoicePlaybackBackend();
  if (backend === "edge") {
    if (await speakViaEdgeTts(clean, voice)) return;
    resetVoicePlaybackBackendCache();
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
  const job = speakQueue.shift()!;
  void playCleanText(job.text, job.voice).finally(() => {
    speaking = false;
    refreshVoiceActivity();
    drainSpeakQueue();
  });
}

function enqueueSpeak(text: string, voice: string): void {
  speakQueue.push({ text, voice });
  refreshVoiceActivity();
  drainSpeakQueue();
}

function speakChunk(text: string, voice: string): void {
  enqueueSpeak(text, voice);
}

export function speakConfirmation(text: string, voice?: string): void {
  if (typeof window === "undefined") return;
  const resolvedVoice = voice ?? voiceForActiveProfile();
  void resolveVoicePlaybackBackend().then(() => enqueueSpeak(text, resolvedVoice));
}

export function pushVoiceChunk(
  profileId: string,
  chunk: string,
  isEnabled: () => boolean
): void {
  if (!chunk || !isEnabled()) return;
  const voice = voiceForProfile(profileId);
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
    speakChunk(sentence, voice);
  }

  let nlIdx = state.buffer.indexOf("\n");
  while (nlIdx >= 0) {
    const line = state.buffer.slice(0, nlIdx + 1);
    state.buffer = state.buffer.slice(nlIdx + 1);
    speakChunk(line, voice);
    nlIdx = state.buffer.indexOf("\n");
  }

  if (state.buffer.length >= MAX_BUFFER_CHARS) {
    speakChunk(state.buffer, voice);
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
        speakChunk(current.buffer, voiceForProfile(profileId));
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
    speakChunk(state.buffer, voiceForProfile(profileId));
    state.buffer = "";
  }
}

export function cancelVoicePlayback(profileId?: string): void {
  if (typeof window === "undefined") return;
  speakQueue.length = 0;
  speaking = false;
  stopCurrentAudio();
  if (profileId) {
    agentVoicePhase.delete(profileId);
    voiceLineCarry.delete(profileId);
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
