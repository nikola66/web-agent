import type { Terminal } from "@xterm/xterm";

/**
 * Snap xterm to the latest output. `terminal.write()` is asynchronous (WriteBuffer uses
 * setTimeout); callers that scroll immediately or on the next animation frame often run before the
 * last chunk is parsed, so scrollTop stops short by one viewport sync.
 *
 * Deferred double scrollToBottom allows the viewport + DOM renderer layout to settle.
 */
export function snapXtermViewportToLatest(term: Terminal | null | undefined): void {
  if (!term) return;
  term.scrollToBottom();
  setTimeout(() => {
    term.scrollToBottom();
    requestAnimationFrame(() => {
      term.scrollToBottom();
    });
  }, 0);
}
