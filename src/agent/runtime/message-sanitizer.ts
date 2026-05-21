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

export function sanitizeMessagesForLlm(messages: ChatMsg[]): ChatMsg[] {
  return dropThinkingOnlyAndMergeUsers(sanitizeApiMessages(messages));
}
