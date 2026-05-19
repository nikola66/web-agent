import { LOOP_GUARD_DEFAULTS } from "./thresholds.js";

export type SupervisorMessage = {
  role: string;
  content: string;
};

export const LOOP_GUARD_HYPOTHESES = {
  continue: "The agent should continue working because the task is not complete.",
  stop: "The agent should stop because the task appears complete.",
  ask_user: "The agent should ask the user for clarification.",
} as const;

export type LoopGuardMeta = {
  userRequest?: string;
  webSearchCount?: number;
  webFetchCount?: number;
  toolsExecutedInTurn?: boolean;
  pendingToolCalls?: string[];
};

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
    return JSON.stringify(content).slice(0, 4000);
  } catch {
    return String(content).slice(0, 4000);
  }
}

export function buildSupervisorPremise(
  messages: SupervisorMessage[],
  maxMessages = LOOP_GUARD_DEFAULTS.maxMessages,
  meta: LoopGuardMeta = {}
): string {
  const recent = messages.slice(-maxMessages);
  const lines = recent.map((m) => `${formatRole(m.role)}: ${messageContent(m.content)}`);
  const metaLines: string[] = [];
  if (meta.userRequest) {
    metaLines.push(`user_request: ${String(meta.userRequest).slice(0, 500)}`);
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
  const body = ["Last messages:", ...lines, ...(metaLines.length ? ["", "Turn context:", ...metaLines] : [])].join(
    "\n"
  );
  return body.trim();
}
