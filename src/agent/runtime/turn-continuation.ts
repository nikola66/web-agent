export const MAX_INTERMEDIATE_ACK_CONTINUATIONS = 2;
export const MAX_EMPTY_AFTER_TOOLS_CONTINUATIONS = 1;

const FUTURE_ACK_RE =
  /\b(i['']ll|i will|let me|i can do that|i can help with that|starting now|starting the|starting with|starting the hunt|i'm starting|i am starting|i'm installing|i am installing|executing|i'm on it|i am on it)\b/i;

const ACTION_MARKERS = [
  "look into",
  "look at",
  "inspect",
  "scan",
  "check",
  "analyz",
  "review",
  "explore",
  "read",
  "open",
  "run",
  "test",
  "fix",
  "debug",
  "search",
  "find",
  "walkthrough",
  "report back",
  "summarize",
  "fetch",
  "install",
  "invoke",
  "scrape",
  "audit",
  "begin",
  "start",
  "hunt",
  "source",
  "enrich",
];

const ACK_PROBE_MAX_CHARS = 1200;
const ACK_TAIL_CHARS = 400;

function ackProbeText(assistantContent: string): string {
  const assistantText = String(assistantContent || "").trim().toLowerCase();
  if (!assistantText) return "";
  if (assistantText.length <= ACK_PROBE_MAX_CHARS) return assistantText;
  return assistantText.slice(-ACK_TAIL_CHARS);
}

export function looksLikeIntermediateAck(assistantContent: string): boolean {
  const probe = ackProbeText(assistantContent);
  if (!probe) return false;

  const hasFutureAck = FUTURE_ACK_RE.test(probe);
  const endsWithNow = /\bnow[.!?]?\s*$/.test(probe);
  if (!hasFutureAck && !/\bstarting\b/.test(probe) && !endsWithNow) return false;

  return ACTION_MARKERS.some((marker) => probe.includes(marker));
}

export function looksLikeEmptyAfterTools(visible: string, executedToolsInTurn: boolean): boolean {
  if (!executedToolsInTurn) return false;
  return !String(visible || "").trim();
}

export type ContinuationNudgeKind = "intermediate_ack" | "empty_after_tools";

export function buildContinuationNudge(kind: ContinuationNudgeKind): string {
  if (kind === "empty_after_tools") {
    return (
      "You just executed tool calls but returned an empty response. " +
      "Please process the tool results above and continue with the task."
    );
  }
  return (
    "[System: Continue now. Execute the required tool calls and only " +
    "send your final answer after completing the task.]"
  );
}

export function shouldContinueIntermediateAck(
  assistantContent: string,
  intermediateAckContinuations: number
): boolean {
  if (intermediateAckContinuations >= MAX_INTERMEDIATE_ACK_CONTINUATIONS) return false;
  return looksLikeIntermediateAck(assistantContent);
}

export function shouldContinueEmptyAfterTools(
  visible: string,
  executedToolsInTurn: boolean,
  emptyAfterToolsContinuations: number
): boolean {
  if (emptyAfterToolsContinuations >= MAX_EMPTY_AFTER_TOOLS_CONTINUATIONS) return false;
  return looksLikeEmptyAfterTools(visible, executedToolsInTurn);
}
