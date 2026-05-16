import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

const MOBILE_MAX_WIDTH = "(max-width: 767px)";

const DESKTOP_FONT_SIZE = 14;
const DESKTOP_LETTER_SPACING = 0.1;
const MIN_FONT_SIZE = 8;

/** Minimum visible columns on phone layouts (FitAddon). */
export const MOBILE_TERMINAL_MIN_COLS = 85;

export function isMobileTerminalViewport(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia(MOBILE_MAX_WIDTH).matches;
  } catch {
    return false;
  }
}

export function fitTerminalForViewport(terminal: Terminal, fitAddon: FitAddon): void {
  if (isMobileTerminalViewport()) {
    terminal.options.letterSpacing = 0;
    let size = DESKTOP_FONT_SIZE;
    for (let i = 0; i < 24; i++) {
      terminal.options.fontSize = size;
      fitAddon.fit();
      if (terminal.cols >= MOBILE_TERMINAL_MIN_COLS || size <= MIN_FONT_SIZE) break;
      size -= 0.5;
    }
  } else {
    terminal.options.fontSize = DESKTOP_FONT_SIZE;
    terminal.options.letterSpacing = DESKTOP_LETTER_SPACING;
    fitAddon.fit();
  }
}
