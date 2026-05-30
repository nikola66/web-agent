const OPEN_TAG_NAMES = [
  "think",
  "thinking",
  "reasoning",
  "thought",
  "REASONING_SCRATCHPAD",
  "redacted_thinking",
] as const;
const OPEN_TAGS = OPEN_TAG_NAMES.map((name) => `<${name}>`);
const CLOSE_TAGS = OPEN_TAG_NAMES.map((name) => `</${name}>`);
const MAX_TAG_LEN = Math.max(...[...OPEN_TAGS, ...CLOSE_TAGS].map((tag) => tag.length));

type ThinkScrubberOptions = {
  onReasoningDelta?: (chunk: string) => void;
};

function findFirstTag(buf: string, tags: readonly string[]): [number, number] {
  const bufLower = buf.toLowerCase();
  let bestIdx = -1;
  let bestLen = 0;
  for (const tag of tags) {
    const idx = bufLower.indexOf(tag.toLowerCase());
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
      bestIdx = idx;
      bestLen = tag.length;
    }
  }
  return [bestIdx, bestLen];
}

function maxPartialSuffix(buf: string, tags: readonly string[]): number {
  if (!buf) return 0;
  const bufLower = buf.toLowerCase();
  const maxCheck = Math.min(bufLower.length, MAX_TAG_LEN - 1);
  for (let i = maxCheck; i > 0; i--) {
    const suffix = bufLower.slice(-i);
    for (const tag of tags) {
      const tagLower = tag.toLowerCase();
      if (tagLower.length > i && tagLower.startsWith(suffix)) return i;
    }
  }
  return 0;
}

function stripOrphanCloseTags(text: string): string {
  if (!text.includes("</")) return text;
  const textLower = text.toLowerCase();
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let matched = false;
    if (textLower.slice(i, i + 2) === "</") {
      for (const tag of CLOSE_TAGS) {
        const tagLower = tag.toLowerCase();
        if (textLower.slice(i, i + tagLower.length) === tagLower) {
          let j = i + tagLower.length;
          while (j < text.length && " \t\n\r".includes(text[j]!)) j += 1;
          i = j;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      out.push(text[i]!);
      i += 1;
    }
  }
  return out.join("");
}

function extractThinkingInterior(buf: string, startIdx: number, endIdx: number): string {
  const bufLower = buf.toLowerCase();
  for (let i = 0; i < OPEN_TAGS.length; i++) {
    const openTag = OPEN_TAGS[i]!;
    const openLower = openTag.toLowerCase();
    if (bufLower.slice(startIdx, startIdx + openLower.length) !== openLower) continue;
    const closeTag = CLOSE_TAGS[i]!;
    const closeLower = closeTag.toLowerCase();
    const closeIdx = bufLower.indexOf(closeLower, startIdx + openTag.length);
    if (closeIdx !== -1 && closeIdx + closeTag.length === endIdx) {
      return buf.slice(startIdx + openTag.length, closeIdx);
    }
  }
  return "";
}

export class StreamingThinkScrubber {
  private _inBlock = false;
  private _buf = "";
  private _lastEmittedEndedNewline = true;
  private _onReasoningDelta?: (chunk: string) => void;

  constructor(opts: ThinkScrubberOptions = {}) {
    this._onReasoningDelta = opts.onReasoningDelta;
  }

  reset(): void {
    this._inBlock = false;
    this._buf = "";
    this._lastEmittedEndedNewline = true;
  }

  feed(text: string): string {
    if (!text) return "";
    let buf = this._buf + text;
    this._buf = "";
    const out: string[] = [];

    while (buf) {
      if (this._inBlock) {
        const [closeIdx, closeLen] = findFirstTag(buf, CLOSE_TAGS);
        if (closeIdx === -1) {
          const held = maxPartialSuffix(buf, CLOSE_TAGS);
          const emitPart = held ? buf.slice(0, -held) : buf;
          this._emitReasoning(emitPart);
          this._buf = held ? buf.slice(-held) : "";
          return out.join("");
        }
        this._emitReasoning(buf.slice(0, closeIdx));
        buf = buf.slice(closeIdx + closeLen);
        this._inBlock = false;
        continue;
      }

      const pair = this.findEarliestClosedPair(buf);
      const [openIdx, openLen] = this.findOpenAtBoundary(buf, out);

      if (pair !== null && (openIdx === -1 || pair[0] <= openIdx)) {
        const [startIdx, endIdx] = pair;
        const preceding = stripOrphanCloseTags(buf.slice(0, startIdx));
        if (preceding) {
          out.push(preceding);
          this._lastEmittedEndedNewline = preceding.endsWith("\n");
        }
        this._emitReasoning(extractThinkingInterior(buf, startIdx, endIdx));
        buf = buf.slice(endIdx);
        continue;
      }

      if (openIdx !== -1) {
        const preceding = stripOrphanCloseTags(buf.slice(0, openIdx));
        if (preceding) {
          out.push(preceding);
          this._lastEmittedEndedNewline = preceding.endsWith("\n");
        }
        this._inBlock = true;
        buf = buf.slice(openIdx + openLen);
        continue;
      }

      const heldOpen = maxPartialSuffix(buf, OPEN_TAGS);
      const heldClose = maxPartialSuffix(buf, CLOSE_TAGS);
      const held = Math.max(heldOpen, heldClose);
      const emitText = held ? buf.slice(0, -held) : buf;
      this._buf = held ? buf.slice(-held) : "";
      if (emitText) {
        const cleaned = stripOrphanCloseTags(emitText);
        if (cleaned) {
          out.push(cleaned);
          this._lastEmittedEndedNewline = cleaned.endsWith("\n");
        }
      }
      return out.join("");
    }

    return out.join("");
  }

  flush(): string {
    if (this._inBlock) {
      if (this._buf) this._emitReasoning(this._buf);
      this._buf = "";
      this._inBlock = false;
      return "";
    }
    const tail = stripOrphanCloseTags(this._buf);
    this._buf = "";
    if (tail) this._lastEmittedEndedNewline = tail.endsWith("\n");
    return tail;
  }

  private _emitReasoning(text: string): void {
    if (!text || !this._onReasoningDelta) return;
    this._onReasoningDelta(text);
  }

  private findEarliestClosedPair(buf: string): [number, number] | null {
    const bufLower = buf.toLowerCase();
    let best: [number, number] | null = null;
    for (let i = 0; i < OPEN_TAGS.length; i++) {
      const openTag = OPEN_TAGS[i]!;
      const closeTag = CLOSE_TAGS[i]!;
      const openIdx = bufLower.indexOf(openTag.toLowerCase());
      if (openIdx === -1) continue;
      const closeIdx = bufLower.indexOf(closeTag.toLowerCase(), openIdx + openTag.length);
      if (closeIdx === -1) continue;
      const endIdx = closeIdx + closeTag.length;
      if (best === null || openIdx < best[0]) best = [openIdx, endIdx];
    }
    return best;
  }

  private findOpenAtBoundary(buf: string, alreadyEmitted: string[]): [number, number] {
    const bufLower = buf.toLowerCase();
    let bestIdx = -1;
    let bestLen = 0;
    for (const tag of OPEN_TAGS) {
      const tagLower = tag.toLowerCase();
      let searchStart = 0;
      while (true) {
        const idx = bufLower.indexOf(tagLower, searchStart);
        if (idx === -1) break;
        if (this.isBlockBoundary(buf, idx, alreadyEmitted)) {
          if (bestIdx === -1 || idx < bestIdx) {
            bestIdx = idx;
            bestLen = tag.length;
          }
          break;
        }
        searchStart = idx + 1;
      }
    }
    return [bestIdx, bestLen];
  }

  private isBlockBoundary(buf: string, idx: number, alreadyEmitted: string[]): boolean {
    if (idx === 0) {
      if (alreadyEmitted.length) return alreadyEmitted[alreadyEmitted.length - 1]!.endsWith("\n");
      return this._lastEmittedEndedNewline;
    }
    const preceding = buf.slice(0, idx);
    const lastNl = preceding.lastIndexOf("\n");
    if (lastNl === -1) {
      const priorNewline = alreadyEmitted.length
        ? alreadyEmitted[alreadyEmitted.length - 1]!.endsWith("\n")
        : this._lastEmittedEndedNewline;
      return priorNewline && preceding.trim() === "";
    }
    return preceding.slice(lastNl + 1).trim() === "";
  }
}
