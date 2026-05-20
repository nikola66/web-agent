import { LOOP_GUARD_DEFAULTS } from "./thresholds.js";

export type SupervisorMessage = {
  role: string;
  content: string;
};

export type LoopGuardMeta = {
  userRequest?: string;
  webSearchCount?: number;
  webFetchCount?: number;
  toolsExecutedInTurn?: boolean;
  pendingToolCalls?: string[];
};

export const LOOP_GUARD_HYPOTHESES = {
  continue: "The agent should continue working because the task is not complete.",
  stop: "The agent should stop because the task appears complete.",
  ask_user: "The agent should ask the user for clarification.",
} as const;

/** Tail sent to MobileBERT (512-token model; tokenizer truncates longer UTF-8). */
export const LOOP_GUARD_PREMISE_MAX_CHARS = 2000;
export const LOOP_GUARD_MESSAGE_TAIL_CHARS = 400;
export const LOOP_GUARD_USER_REQUEST_TAIL_CHARS = 200;

function formatRole(role: string): string {
  const r = String(role || "").toLowerCase();
  if (r === "assistant") return "Agent";
  if (r === "user") return "User";
  if (r === "tool") return "Tool";
  if (r === "system") return "System";
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : "Unknown";
}

function messageContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function tailText(text: string, maxChars: number): string {
  const trimmed = String(text ?? "").trim();
  if (maxChars <= 0 || trimmed.length <= maxChars) return trimmed;
  return `…${trimmed.slice(-maxChars)}`;
}

function joinPremise(messageLines: string[], metaLines: string[]): string {
  return [
    "Last messages:",
    ...messageLines,
    ...(metaLines.length ? ["", "Turn context:", ...metaLines] : []),
  ].join("\n");
}

export function buildSupervisorPremise(
  messages: SupervisorMessage[],
  maxMessages = LOOP_GUARD_DEFAULTS.maxMessages,
  meta: LoopGuardMeta = {}
): string {
  const recent = messages.slice(-maxMessages);
  let messageLines = recent.map(
    (m) =>
      `${formatRole(m.role)}: ${tailText(messageContent(m.content), LOOP_GUARD_MESSAGE_TAIL_CHARS)}`
  );
  const metaLines: string[] = [];
  if (meta.userRequest) {
    metaLines.push(
      `user_request: ${tailText(String(meta.userRequest), LOOP_GUARD_USER_REQUEST_TAIL_CHARS)}`
    );
  }
  if (typeof meta.webSearchCount === "number") {
    metaLines.push(`web_search_count: ${meta.webSearchCount}`);
  }
  if (typeof meta.webFetchCount === "number") {
    metaLines.push(`web_fetch_count: ${meta.webFetchCount}`);
  }
  if (typeof meta.toolsExecutedInTurn === "boolean") {
    metaLines.push(`tools_executed_this_turn: ${meta.toolsExecutedInTurn}`);
  }
  if (Array.isArray(meta.pendingToolCalls) && meta.pendingToolCalls.length) {
    metaLines.push(`pending_tool_calls: ${meta.pendingToolCalls.join(", ")}`);
  }

  while (
    messageLines.length > 1 &&
    joinPremise(messageLines, metaLines).length > LOOP_GUARD_PREMISE_MAX_CHARS
  ) {
    messageLines.shift();
  }

  let body = joinPremise(messageLines, metaLines);
  if (body.length > LOOP_GUARD_PREMISE_MAX_CHARS) {
    body = tailText(body, LOOP_GUARD_PREMISE_MAX_CHARS);
  }
  return body.trim();
}
