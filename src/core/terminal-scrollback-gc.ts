import type { Terminal } from "@xterm/xterm";

const DEFAULT_SCROLLBACK_MAX = 2500;
const DEFAULT_TRIM_THRESHOLD = 1800;
const DEFAULT_TRIM_KEEP_LINES = 900;

export interface TerminalScrollbackConfig {
  scrollbackMax: number;
  trimThreshold: number;
  trimKeepLines: number;
}

export interface ScrollbackBufferView {
  length: number;
  getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
}

function parseEnvInt(name: string, fallback: number): number {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const raw = String(env?.[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

export function resolveTerminalScrollbackConfig(): TerminalScrollbackConfig {
  return {
    scrollbackMax: parseEnvInt("VITE_WEBAGENT_TERMINAL_SCROLLBACK", DEFAULT_SCROLLBACK_MAX),
    trimThreshold: parseEnvInt("VITE_WEBAGENT_TERMINAL_TRIM_THRESHOLD", DEFAULT_TRIM_THRESHOLD),
    trimKeepLines: parseEnvInt("VITE_WEBAGENT_TERMINAL_TRIM_KEEP", DEFAULT_TRIM_KEEP_LINES),
  };
}

export const TERMINAL_SCROLLBACK_MAX = resolveTerminalScrollbackConfig().scrollbackMax;

export function shouldTrimScrollback(
  bufferLength: number,
  threshold: number,
  force = false
): boolean {
  return force || bufferLength > threshold;
}

export function computeDroppedLines(bufferLength: number, keepLines: number): number {
  if (bufferLength <= keepLines) return 0;
  return bufferLength - keepLines;
}

export function captureBufferTailLines(buffer: ScrollbackBufferView, keepLines: number): string[] {
  const len = buffer.length;
  if (len === 0) return [];
  const start = Math.max(0, len - keepLines);
  const lines: string[] = [];
  for (let i = start; i < len; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines;
}

export function maybeTrimTerminalScrollback(
  terminal: Terminal,
  opts?: { force?: boolean; config?: TerminalScrollbackConfig }
): { trimmed: boolean; droppedLines: number } {
  const config = opts?.config ?? resolveTerminalScrollbackConfig();
  const buffer = terminal.buffer.active;
  const length = buffer.length;
  if (!shouldTrimScrollback(length, config.trimThreshold, opts?.force)) {
    return { trimmed: false, droppedLines: 0 };
  }

  const keepLines = Math.min(config.trimKeepLines, length);
  const droppedLines = computeDroppedLines(length, keepLines);
  const tailLines = captureBufferTailLines(buffer, keepLines);

  terminal.clear();
  terminal.write(
    `\x1b[90m── earlier output trimmed (${droppedLines} lines) · use session_search for history ──\x1b[0m\r\n`
  );
  for (const line of tailLines) {
    terminal.write(`${line}\r\n`);
  }

  return { trimmed: true, droppedLines };
}
