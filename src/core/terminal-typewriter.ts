import type { Terminal } from "@xterm/xterm";

/** Per-profile queue: smooth type-out while bytes arrive; fast drain when idle. */
interface TypewriterState {
  pending: string;
  rafId: number | null;
  lastArrivalAt: number;
}

const states = new Map<string, TypewriterState>();

function stateFor(profileId: string): TypewriterState {
  let s = states.get(profileId);
  if (!s) {
    s = { pending: "", rafId: null, lastArrivalAt: 0 };
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

  try {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const first = seg.segment(buffer)[Symbol.iterator]().next().value;
    if (first?.segment) {
      return { kind: "unit", unit: first.segment, rest: buffer.slice(first.segment.length) };
    }
  } catch {
    /* no Segmenter */
  }
  const cp = buffer.codePointAt(0);
  if (cp === undefined) return { kind: "unit", unit: "", rest: "" };
  const len = cp > 0xffff ? 2 : 1;
  return { kind: "unit", unit: buffer.slice(0, len), rest: buffer.slice(len) };
}

function drainStep(
  profileId: string,
  resolveTerminal: (id: string) => Terminal | null
): void {
  const s = stateFor(profileId);
  const term = resolveTerminal(profileId);
  if (!term || !s.pending.length) {
    s.rafId = null;
    return;
  }

  const idleMs = performance.now() - s.lastArrivalAt;
  const catchingUp = idleMs > 40;
  let stepsBudget = catchingUp ? 200 : 2;

  if (catchingUp && s.pending.length > 8000) {
    stepsBudget = Math.min(4000, Math.ceil(s.pending.length / 12));
  }

  while (stepsBudget > 0 && s.pending.length > 0) {
    const peeled = peelNextAtomicUnit(s.pending);
    if (peeled.kind === "wait") break;
    if (!peeled.unit) break;
    term.write(peeled.unit);
    s.pending = peeled.rest;
    stepsBudget -= 1;
  }

  if (s.pending.length > 0) {
    s.rafId = requestAnimationFrame(() => drainStep(profileId, resolveTerminal));
  } else {
    s.rafId = null;
  }
}

function schedule(profileId: string, resolveTerminal: (id: string) => Terminal | null): void {
  const s = stateFor(profileId);
  if (s.rafId !== null) return;
  s.rafId = requestAnimationFrame(() => drainStep(profileId, resolveTerminal));
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

/** Write any pending bytes immediately (e.g. agent stopped). */
export function flushTerminalTypewriter(
  profileId: string,
  resolveTerminal: (id: string) => Terminal | null
): void {
  const s = states.get(profileId);
  if (!s) return;
  if (s.rafId !== null) {
    cancelAnimationFrame(s.rafId);
    s.rafId = null;
  }
  const term = resolveTerminal(profileId);
  if (term && s.pending.length > 0) term.write(s.pending);
  s.pending = "";
}
