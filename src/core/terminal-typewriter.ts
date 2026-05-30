import type { Terminal } from "@xterm/xterm";

/** Per-profile queue: smooth type-out while bytes arrive; fast drain when idle. */
interface TypewriterState {
  pending: string;
  tickId: ReturnType<typeof setTimeout> | null;
  lastArrivalAt: number;
}

const states = new Map<string, TypewriterState>();

/** Still receiving stream bytes — keep a readable cadence. */
export const ACTIVE_ARRIVAL_MS = 150;
/** After this idle gap, allow moderate catch-up (never a single-frame dump). */
export const CATCH_UP_IDLE_MS = 500;
export const UNITS_WHILE_STREAMING = 2;
export const UNITS_WHILE_DRAINING = 5;
export const UNITS_CATCH_UP_MAX = 48;
/** Artificial pacing between writes while the stream is active (~55 chars/s at 2 units / 18ms). */
export const STREAM_TICK_MS = 18;

let graphemeSegmenter: Intl.Segmenter | null = null;
function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter) return graphemeSegmenter;
  try {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return graphemeSegmenter;
  } catch {
    return null;
  }
}

export function computeTypewriterDrainBudget(pendingLength: number, idleMs: number): number {
  const streaming = idleMs < ACTIVE_ARRIVAL_MS;
  if (streaming) return UNITS_WHILE_STREAMING;
  if (idleMs > CATCH_UP_IDLE_MS) {
    return Math.min(
      UNITS_CATCH_UP_MAX,
      Math.max(UNITS_WHILE_DRAINING, Math.ceil(pendingLength / 80)),
    );
  }
  return UNITS_WHILE_DRAINING;
}

function stateFor(profileId: string): TypewriterState {
  let s = states.get(profileId);
  if (!s) {
    s = { pending: "", tickId: null, lastArrivalAt: 0 };
    states.set(profileId, s);
  }
  return s;
}

type Peel = { kind: "unit"; unit: string; rest: string } | { kind: "wait" };

/**
 * Split so each write() is one terminal atom: CRLF, full CSI/OSC/DCS, charset 3-byte, or one grapheme.
 */
function peelNextAtomicUnit(buffer: string): Peel {
  if (!buffer.length) return { kind: "unit", unit: "", rest: "" };
  if (buffer.startsWith("\r\n")) return { kind: "unit", unit: "\r\n", rest: buffer.slice(2) };
  const c0 = buffer[0];
  if (c0 === "\n" || c0 === "\r") return { kind: "unit", unit: c0, rest: buffer.slice(1) };

  if (c0 === "\x1b") {
    if (buffer.length < 2) return { kind: "wait" };
    const c1 = buffer[1];
    if (c1 === "[") {
      for (let i = 2; i < buffer.length; i++) {
        const code = buffer.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) {
          return { kind: "unit", unit: buffer.slice(0, i + 1), rest: buffer.slice(i + 1) };
        }
      }
      return { kind: "wait" };
    }
    if (c1 === "]" || c1 === "P") {
      for (let i = 2; i < buffer.length; i++) {
        if (buffer.charCodeAt(i) === 0x07) {
          return { kind: "unit", unit: buffer.slice(0, i + 1), rest: buffer.slice(i + 1) };
        }
        if (buffer[i] === "\x1b" && buffer[i + 1] === "\\") {
          return { kind: "unit", unit: buffer.slice(0, i + 2), rest: buffer.slice(i + 2) };
        }
      }
      return { kind: "wait" };
    }
    if (c1 === "(" || c1 === ")") {
      if (buffer.length < 3) return { kind: "wait" };
      return { kind: "unit", unit: buffer.slice(0, 3), rest: buffer.slice(3) };
    }
    return { kind: "unit", unit: buffer.slice(0, 2), rest: buffer.slice(2) };
  }

  const seg = getGraphemeSegmenter();
  if (seg) {
    const first = seg.segment(buffer)[Symbol.iterator]().next().value;
    if (first?.segment) {
      return { kind: "unit", unit: first.segment, rest: buffer.slice(first.segment.length) };
    }
  }
  const cp = buffer.codePointAt(0);
  if (cp === undefined) return { kind: "unit", unit: "", rest: "" };
  const len = cp > 0xffff ? 2 : 1;
  return { kind: "unit", unit: buffer.slice(0, len), rest: buffer.slice(len) };
}

function cancelTick(s: TypewriterState): void {
  if (s.tickId === null) return;
  clearTimeout(s.tickId);
  s.tickId = null;
}

function schedule(profileId: string, resolveTerminal: (id: string) => Terminal | null): void {
  const s = stateFor(profileId);
  if (s.tickId !== null) return;
  const idleMs = performance.now() - s.lastArrivalAt;
  const delay = idleMs < ACTIVE_ARRIVAL_MS ? STREAM_TICK_MS : 0;
  s.tickId = setTimeout(() => {
    s.tickId = null;
    drainStep(profileId, resolveTerminal);
  }, delay);
}

function drainStep(
  profileId: string,
  resolveTerminal: (id: string) => Terminal | null
): void {
  const s = stateFor(profileId);
  const term = resolveTerminal(profileId);
  if (!term || !s.pending.length) {
    cancelTick(s);
    return;
  }

  const idleMs = performance.now() - s.lastArrivalAt;
  let stepsBudget = computeTypewriterDrainBudget(s.pending.length, idleMs);

  while (stepsBudget > 0 && s.pending.length > 0) {
    const peeled = peelNextAtomicUnit(s.pending);
    if (peeled.kind === "wait") {
      // Chunk ended mid-escape; after idle, force one byte so later output is not blocked forever.
      if (idleMs > CATCH_UP_IDLE_MS) {
        term.write(s.pending[0]);
        s.pending = s.pending.slice(1);
        stepsBudget -= 1;
        continue;
      }
      break;
    }
    if (!peeled.unit) break;
    term.write(peeled.unit);
    s.pending = peeled.rest;
    stepsBudget -= 1;
  }

  if (s.pending.length > 0) {
    schedule(profileId, resolveTerminal);
  }
}

/**
 * Queue terminal bytes for this profile; they are written through xterm with a typewriter cadence.
 */
export function enqueueTerminalTypewriter(
  profileId: string,
  chunk: string,
  resolveTerminal: (id: string) => Terminal | null
): void {
  if (!chunk) return;
  const s = stateFor(profileId);
  s.pending += chunk;
  s.lastArrivalAt = performance.now();
  schedule(profileId, resolveTerminal);
}

/** Drop queued typewriter state when a profile is removed. */
export function disposeTypewriter(profileId: string): void {
  const s = states.get(profileId);
  if (!s) return;
  cancelTick(s);
  states.delete(profileId);
}

/** Write any pending bytes immediately (e.g. agent stopped). */
export function flushTerminalTypewriter(
  profileId: string,
  resolveTerminal: (id: string) => Terminal | null
): void {
  const s = states.get(profileId);
  if (!s) return;
  cancelTick(s);
  const term = resolveTerminal(profileId);
  if (term && s.pending.length > 0) term.write(s.pending);
  s.pending = "";
}
