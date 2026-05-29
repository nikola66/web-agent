import { randomUUID } from "node:crypto";

export function messageContentToText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
      else if (typeof part.text === "string") parts.push(part.text);
      else return null;
    }
    return parts.join("\n");
  }
  return null;
}

export function openAiMessagesToDemo(messages) {
  if (!Array.isArray(messages)) return { ok: false, error: "messages must be an array" };
  const out = [];
  for (const msg of messages) {
    const role = String(msg?.role || "").trim();
    if (!role || !["system", "user", "assistant", "tool"].includes(role)) {
      return { ok: false, error: `unsupported message role: ${role || "(empty)"}` };
    }
    if (role === "tool") {
      const text = messageContentToText(msg.content);
      if (text === null) return { ok: false, error: "tool messages must use text content" };
      out.push({ role: "user", content: `[tool result]\n${text}` });
      continue;
    }
    const text = messageContentToText(msg.content);
    if (text === null) return { ok: false, error: "only text message content is supported for BitNet demo" };
    out.push({ role, content: text });
  }
  return { ok: true, messages: out };
}

export function buildDemoPayload({ messages, profileId, sessionId, device }) {
  const mapped = openAiMessagesToDemo(messages);
  if (!mapped.ok) return mapped;
  const profile = String(profileId || "default").trim() || "default";
  const session = String(sessionId || profile).trim() || profile;
  return {
    ok: true,
    body: {
      messages: mapped.messages,
      userId: `webagent-${profile}`,
      chatId: `webagent-${session}`,
      device: String(device || "cpu").trim() || "cpu",
    },
  };
}

export function createStreamChunkId() {
  return `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** Demo marks stream end with content "[DONE]" — must not forward as assistant text. */
export function isDemoSentinelContent(content) {
  return String(content ?? "").trim() === "[DONE]";
}

export function openAiChunkLine(id, model, delta, finishReason = null) {
  const payload = {
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: String(model || "bitnet-b1.58-2b-4t"),
    choices: [{ index: 0, delta: delta || {}, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export function demoEventToOpenAiLines(demoJson, state) {
  const lines = [];
  if (!demoJson || typeof demoJson !== "object") return lines;
  const content = demoJson.content;
  if (typeof content === "string" && content && !isDemoSentinelContent(content)) {
    lines.push(openAiChunkLine(state.id, state.model, { content }));
  }
  if (demoJson.finished === true && !state.finished) {
    state.finished = true;
    lines.push(openAiChunkLine(state.id, state.model, {}, "stop"));
    lines.push("data: [DONE]\n\n");
  }
  return lines;
}

export function parseDemoSseBuffer(buffer, state) {
  const out = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";
  for (const block of parts) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr) continue;
      try {
        const parsed = JSON.parse(dataStr);
        out.push(...demoEventToOpenAiLines(parsed, state));
      } catch {
        /* ignore malformed demo SSE */
      }
    }
  }
  return { lines: out, remainder };
}

export function mapDemoHttpError(status, bodyText) {
  const text = String(bodyText || "");
  if (status === 503 || /queue is full/i.test(text)) {
    return { status: 503, message: "BitNet demo queue is full — try again later." };
  }
  if (status >= 500) {
    return { status: 502, message: "BitNet demo upstream error." };
  }
  return { status: status || 502, message: text.slice(0, 500) || "BitNet demo request failed." };
}
