/**
 * Pre-LLM message hygiene (Hermes-style): repair tool pairs, drop thinking-only
 * assistant turns, merge adjacent user messages. Operates on per-call copies only.
 */

const VALID_API_ROLES = new Set(["system", "user", "assistant", "tool"]);
const STUB_TOOL_RESULT = "[Result unavailable — see context summary above]";

type ChatMsg = {
  role?: string;
  content?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
};

function messageContentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const row = part as { type?: string; text?: string };
        if (typeof row.text === "string") return row.text;
      }
      return "";
    })
    .join("")
    .trim();
}

export function isThinkingOnlyAssistant(message: ChatMsg | null | undefined): boolean {
  if (message?.role !== "assistant") return false;
  const text = messageContentText(message.content);
  if (!text) return true;
  return text.toLowerCase() === "thought";
}

function toolCallId(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object") return "";
  const row = toolCall as { id?: string; function?: { name?: string } };
  return String(row.id || "").trim();
}

function toolCallName(toolCall: unknown): string {
  if (!toolCall || typeof toolCall !== "object") return "tool";
  const row = toolCall as { function?: { name?: string }; name?: string };
  return String(row.function?.name || row.name || "tool").trim() || "tool";
}

function mergeAdjacentUserContent(prev: unknown, cur: unknown): unknown {
  if (typeof prev === "string" && typeof cur === "string") {
    if (!prev) return cur;
    if (!cur) return prev;
    return `${prev}\n\n${cur}`;
  }
  if (Array.isArray(prev) && Array.isArray(cur)) {
    return [...prev, ...cur];
  }
  if (Array.isArray(prev) && typeof cur === "string") {
    return cur ? [...prev, { type: "text", text: cur }] : [...prev];
  }
  if (typeof prev === "string" && Array.isArray(cur)) {
    const blocks: unknown[] = prev ? [{ type: "text", text: prev }] : [];
    return [...blocks, ...cur];
  }
  return cur ?? prev;
}

export function sanitizeApiMessages(messages: ChatMsg[]): ChatMsg[] {
  const input = Array.isArray(messages) ? messages : [];
  const filtered = input.filter((msg) => VALID_API_ROLES.has(String(msg?.role || "")));

  const survivingCallIds = new Set<string>();
  for (const msg of filtered) {
    if (msg.role !== "assistant") continue;
    for (const tc of msg.tool_calls || []) {
      const id = toolCallId(tc);
      if (id) survivingCallIds.add(id);
    }
  }

  const resultCallIds = new Set<string>();
  for (const msg of filtered) {
    if (msg.role !== "tool") continue;
    const id = String(msg.tool_call_id || "").trim();
    if (id) resultCallIds.add(id);
  }

  const orphaned = new Set([...resultCallIds].filter((id) => !survivingCallIds.has(id)));
  let out = orphaned.size
    ? filtered.filter((msg) => !(msg.role === "tool" && orphaned.has(String(msg.tool_call_id || ""))))
    : filtered;

  const missing = new Set([...survivingCallIds].filter((id) => !resultCallIds.has(id)));
  if (missing.size) {
    const patched: ChatMsg[] = [];
    for (const msg of out) {
      patched.push(msg);
      if (msg.role !== "assistant") continue;
      for (const tc of msg.tool_calls || []) {
        const id = toolCallId(tc);
        if (id && missing.has(id)) {
          patched.push({
            role: "tool",
            name: toolCallName(tc),
            content: STUB_TOOL_RESULT,
            tool_call_id: id,
          });
        }
      }
    }
    out = patched;
  }

  return out.map((msg) => ({ ...msg }));
}

export function dropThinkingOnlyAndMergeUsers(messages: ChatMsg[]): ChatMsg[] {
  const input = Array.isArray(messages) ? messages : [];
  if (!input.length) return input;

  const kept = input.filter((msg) => !isThinkingOnlyAssistant(msg));
  if (kept.length === input.length) return input.map((msg) => ({ ...msg }));

  const merged: ChatMsg[] = [];
  for (const msg of kept) {
    const prev = merged[merged.length - 1];
    if (prev?.role === "user" && msg.role === "user") {
      merged[merged.length - 1] = {
        ...prev,
        content: mergeAdjacentUserContent(prev.content, msg.content),
      };
      continue;
    }
    merged.push({ ...msg });
  }
  return merged;
}

export function repairMessageSequence(messages: ChatMsg[]): ChatMsg[] {
  const input = Array.isArray(messages) ? messages : [];
  if (!input.length) return input;

  let repairs = 0;
  let knownToolIds = new Set<string>();
  const filtered: ChatMsg[] = [];

  for (const msg of input) {
    if (!msg || typeof msg !== "object") {
      filtered.push(msg);
      continue;
    }
    const role = String(msg.role || "");
    if (role === "assistant") {
      knownToolIds = new Set<string>();
      for (const tc of msg.tool_calls || []) {
        const id = toolCallId(tc);
        if (id) knownToolIds.add(id);
      }
      filtered.push(msg);
    } else if (role === "tool") {
      const id = String(msg.tool_call_id || "").trim();
      if (id && knownToolIds.has(id)) {
        filtered.push(msg);
      } else {
        repairs += 1;
      }
    } else {
      if (role === "user") knownToolIds = new Set<string>();
      filtered.push(msg);
    }
  }

  const merged: ChatMsg[] = [];
  for (const msg of filtered) {
    const prev = merged[merged.length - 1];
    if (
      prev?.role === "user" &&
      msg.role === "user" &&
      typeof prev.content === "string" &&
      typeof msg.content === "string" &&
      !isToolResultsUserMessage(prev.content) &&
      !isToolResultsUserMessage(msg.content) &&
      !String(msg.content || "").startsWith("[System:")
    ) {
      prev.content = mergeAdjacentUserContent(prev.content, msg.content) as string;
      repairs += 1;
      continue;
    }
    merged.push({ ...msg });
  }

  void repairs;
  return merged;
}

function isToolResultsUserMessage(content: unknown): boolean {
  return typeof content === "string" && content.startsWith("Tool results (compact JSON)");
}

function isEmptyRecoverySynthetic(msg: ChatMsg | undefined): boolean {
  if (!msg || typeof msg !== "object") return false;
  return Boolean((msg as { _empty_recovery_synthetic?: boolean })._empty_recovery_synthetic);
}

/** Port of Hermes run_agent._drop_trailing_empty_response_scaffolding */
export function dropTrailingEmptyResponseScaffolding(messages: ChatMsg[]): ChatMsg[] {
  const out = [...messages];
  let droppedScaffolding = false;

  while (out.length && isEmptyRecoverySynthetic(out[out.length - 1])) {
    out.pop();
    droppedScaffolding = true;
  }

  if (!droppedScaffolding) return out;

  while (out.length && out[out.length - 1]?.role === "tool") {
    out.pop();
  }

  const last = out[out.length - 1];
  if (last?.role === "assistant" && Array.isArray(last.tool_calls) && last.tool_calls.length) {
    out.pop();
  }

  return out;
}

export function sanitizeMessagesForLlm(messages: ChatMsg[]): ChatMsg[] {
  return dropThinkingOnlyAndMergeUsers(repairMessageSequence(sanitizeApiMessages(messages)));
}
