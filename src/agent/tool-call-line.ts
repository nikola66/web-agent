/** Matches `▸ [emoji]tool_name {` or `▸ [emoji]tool_name` (telegram-style). */
const TOOL_START_BODY_RE =
  /^(?:\p{Extended_Pictographic}\uFE0F?\s*)*([a-z][a-z0-9_]*(?::[a-z0-9_]*)*)\s*(?:\{|\s*$)/u;

const NON_TOOL_PREFIXES = [
  "heartbeat",
  "cron ",
  "cron'",
  "skipped ",
  "deferred ",
  "tool guardrail",
  "no cron",
  "curator error",
  "retry ",
];

export function parseToolStartTranscriptLine(line: string): string | null {
  const plain = String(line || "").trim();
  if (!plain.startsWith("▸")) return null;
  const rest = plain.slice(1).trimStart();
  const lower = rest.toLowerCase();
  for (const prefix of NON_TOOL_PREFIXES) {
    if (lower.startsWith(prefix)) return null;
  }
  const match = rest.match(TOOL_START_BODY_RE);
  return match?.[1] ?? null;
}
