export const REASONING_PREVIEW_IPC_START = "<<<WEBAGENT_REASONING_PREVIEW>>>";
export const REASONING_PREVIEW_IPC_END = "<<<END_WEBAGENT_REASONING_PREVIEW>>>";

function longestPartialMarkerSuffix(buf: string, marker: string): number {
  const max = Math.min(buf.length, marker.length - 1);
  for (let len = max; len > 0; len--) {
    if (marker.startsWith(buf.slice(-len))) return len;
  }
  return 0;
}

/** Strip reasoning-preview IPC blocks before terminal buffering so incomplete markers never block visible output. */
export function stripReasoningPreviewFromStream(
  carry: string,
  chunk: string,
  onPreview?: (payload: { text: string; done: boolean }) => void
): { data: string; nextCarry: string } {
  let buf = carry + chunk;
  let out = "";
  while (buf.length > 0) {
    const start = buf.indexOf(REASONING_PREVIEW_IPC_START);
    if (start < 0) {
      const hold = longestPartialMarkerSuffix(buf, REASONING_PREVIEW_IPC_START);
      if (hold > 0) {
        out += buf.slice(0, buf.length - hold);
        return { data: out, nextCarry: buf.slice(-hold) };
      }
      out += buf;
      return { data: out, nextCarry: "" };
    }
    if (start > 0) {
      out += buf.slice(0, start);
      buf = buf.slice(start);
      continue;
    }
    const end = buf.indexOf(REASONING_PREVIEW_IPC_END);
    if (end < 0) return { data: out, nextCarry: buf };
    const payload = buf.slice(REASONING_PREVIEW_IPC_START.length, end).trim();
    try {
      const parsed = JSON.parse(payload) as { text?: string; done?: boolean };
      onPreview?.({
        text: String(parsed.text || "").trim(),
        done: Boolean(parsed.done),
      });
    } catch {
      /* malformed reasoning preview block */
    }
    buf = buf.slice(end + REASONING_PREVIEW_IPC_END.length);
  }
  return { data: out, nextCarry: "" };
}
