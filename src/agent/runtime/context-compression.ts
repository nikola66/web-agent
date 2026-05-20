import { OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW, LLM_REQUEST_TIMEOUT_MS } from "./constants.js";
import { logDebugEvent } from "./logging/debug-log.js";
import { estimateMessageTokens, estimateMessagesTokens, fetchWithTimeout } from "./llm/streaming.js";
import { errorMessage } from "./utils.js";

export const CONTEXT_COMPACTION_PREFIX = "[CONTEXT COMPACTION]";
export const CONTEXT_COMPACTION_THRESHOLD_RATIO = 0.5;
const MIN_TAIL_MESSAGES = 20;
const TOOL_RESULT_PREFIX = "Tool results (compact JSON):";
const LARGE_TOOL_RESULT_CHAR_LIMIT = 1500;

function sanitizeHeadersForFetch(headers = {}) {
  const out = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    out[name] = String(rawValue ?? "").replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}

function contextWindowTokens(cfg) {
  const value = Number(cfg?.contextWindowTokens);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW;
}

function compactionThresholdTokens(cfg) {
  return Math.floor(contextWindowTokens(cfg) * CONTEXT_COMPACTION_THRESHOLD_RATIO);
}

function isCompactionMessage(message) {
  return (
    message?.role === "assistant" &&
    String(message?.content || "").trimStart().startsWith(CONTEXT_COMPACTION_PREFIX)
  );
}

const MIN_HEAD_PAIRS_FOR_COMPACTION = Math.max(
  1,
  Math.min(
    12,
    Number(process.env.WEBAGENT_COMPACTION_HEAD_EXCHANGES) || 4
  )
);

/**
 * Indices [0, count) preserved as head before compaction summarizes the middle region.
 * Keeps earliest user intent + grounding (default four user→assistant exchanges when present).
 *
 * Caps head so at least MIN_TAIL_MESSAGES non-system slots can remain — otherwise tailStart
 * cannot clear headCount and compaction would no-op (“not_enough_history”).
 */
function firstExchangeCount(nonSystemMessages) {
  const n = nonSystemMessages.length;
  if (!n) return 0;
  const clampHeadEnd = (end) =>
    Math.min(end, Math.max(2, n - MIN_TAIL_MESSAGES - 1));
  let pairs = 0;
  let i = 0;
  while (pairs < MIN_HEAD_PAIRS_FOR_COMPACTION && i < n) {
    if (nonSystemMessages[i]?.role !== "user") {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < n && nonSystemMessages[j]?.role !== "assistant") j += 1;
    if (j >= n) {
      return clampHeadEnd(Math.min(n, i + 1));
    }
    pairs += 1;
    i = j + 1;
  }
  return clampHeadEnd(i);
}

function tailStartIndex(nonSystemMessages, headCount, thresholdTokens) {
  const maxTail = Math.max(0, nonSystemMessages.length - headCount);
  const minTail = Math.min(MIN_TAIL_MESSAGES, maxTail);
  const tailBudgetTokens = Math.max(1, Math.floor(thresholdTokens * 0.2));
  let start = nonSystemMessages.length;
  let tailTokens = 0;
  while (start > headCount) {
    const tailCount = nonSystemMessages.length - start;
    if (tailCount >= minTail && tailTokens >= tailBudgetTokens) break;
    start -= 1;
    tailTokens += estimateMessageTokens(nonSystemMessages[start]);
  }
  return start;
}

export function pruneMessageForCompactionInput(message) {
  const content = String(message?.content || "");
  if (
    content.startsWith(TOOL_RESULT_PREFIX) &&
    content.length > LARGE_TOOL_RESULT_CHAR_LIMIT
  ) {
    return {
      ...message,
      content:
        `${TOOL_RESULT_PREFIX}\n` +
        `[pruned: large historical tool-result JSON omitted before context compaction; ` +
        `original ${content.length} characters]`,
    };
  }
  return message;
}

function renderMessagesForSummary(messages) {
  return messages
    .map((message, index) => {
      const role = String(message?.role || "unknown");
      const content = String(message?.content || "");
      return `#${index + 1} ${role}\n${content}`;
    })
    .join("\n\n---\n\n");
}

function buildSummaryPrompt(previousSummaries) {
  const previousInstruction = previousSummaries.length
    ? "Previous context compaction summaries are included below. Update and consolidate them with the new middle history instead of starting from scratch."
    : "No previous context compaction summary was found. Create a fresh summary of the middle history.";
  return [
    "You compact conversation history for Web Agent. Preserve concrete facts, user intent, constraints, unresolved tasks, file paths, commands, failures, and decisions.",
    previousInstruction,
    `Return one concise structured summary beginning with exactly ${CONTEXT_COMPACTION_PREFIX}.`,
    "Use these sections: Goal, Constraints & Preferences, Progress, Key Decisions, Relevant Files, Next Steps, Critical Context.",
    "Do not invent details. Do not include tool-call JSON unless it is essential; summarize outcomes instead.",
  ].join("\n");
}

function buildSummaryUserContent(messages, previousSummaries) {
  const parts = [];
  if (previousSummaries.length) {
    parts.push(
      "Previous compaction summaries:\n" +
        previousSummaries.map((message) => String(message?.content || "").trim()).join("\n\n")
    );
  }
  parts.push("Middle history to compact:\n" + renderMessagesForSummary(messages));
  return parts.join("\n\n");
}

function normalizeSummaryContent(content) {
  const text = String(content || "").trim();
  if (text.startsWith(CONTEXT_COMPACTION_PREFIX)) return text;
  return `${CONTEXT_COMPACTION_PREFIX}\n${text}`;
}

/**
 * Non-stream chat/completions responses vary by provider: string content, content parts array,
 * or reasoning-only payloads. Compaction must accept the same shapes streaming.js hints at.
 */
export function extractNonStreamAssistantText(payload) {
  const choice = payload?.choices?.[0];
  const msg = choice?.message || choice;
  if (!msg || typeof msg !== "object") return "";
  const refusal = typeof msg.refusal === "string" ? msg.refusal.trim() : "";
  if (refusal) {
    throw new Error(`model refused compaction summary: ${refusal.slice(0, 500)}`);
  }
  let text = "";
  if (typeof msg.content === "string") text = msg.content;
  else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (typeof part === "string") text += part;
      else if (part && typeof part === "object") {
        if (typeof part.text === "string") text += part.text;
        else if (part.type === "text" && typeof part.text === "string") text += part.text;
      }
    }
  }
  if (!String(text).trim()) {
    if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
      text = msg.reasoning_content;
    } else if (typeof msg.reasoning === "string" && msg.reasoning.trim()) {
      text = msg.reasoning;
    }
  }
  return String(text || "").trim();
}

async function summarizeWithOpenAICompatibleProvider({ cfg, messages, previousSummaries }) {
  if (!cfg?.baseUrl || !cfg?.model) {
    throw new Error("missing LLM provider configuration");
  }
  const headers = sanitizeHeadersForFetch({
    "Content-Type": "application/json",
    ...cfg.extraHeaders,
  });
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const body = {
    model: cfg.model,
    messages: [
      { role: "system", content: buildSummaryPrompt(previousSummaries) },
      { role: "user", content: buildSummaryUserContent(messages, previousSummaries) },
    ],
    stream: false,
    max_tokens: 2048,
  };
  const res = await fetchWithTimeout(
    `${String(cfg.baseUrl).replace(/\/$/, "")}/chat/completions`,
    { method: "POST", headers, body: JSON.stringify(body) },
    LLM_REQUEST_TIMEOUT_MS,
    `${cfg.provider || "LLM"} context compaction request`
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`context compaction request failed: ${res.status} ${errText}`.trim());
  }
  const payload = await res.json();
  const content = extractNonStreamAssistantText(payload);
  if (!content) throw new Error("context compaction returned an empty summary");
  return content;
}

function unchanged(messages, beforeTokens, reason, extra = {}) {
  return {
    messages,
    changed: false,
    beforeTokens,
    afterTokens: beforeTokens,
    beforeMessages: Array.isArray(messages) ? messages.length : 0,
    afterMessages: Array.isArray(messages) ? messages.length : 0,
    reason,
    ...extra,
  };
}

async function compactMessages(messages, cfg, options = {}) {
  const input = Array.isArray(messages) ? messages : [];
  const force = Boolean(options.force);
  const thresholdTokens = compactionThresholdTokens(cfg);
  const beforeTokens = estimateMessagesTokens(input);
  if (!force && beforeTokens < thresholdTokens) {
    return unchanged(input, beforeTokens, "below_threshold");
  }

  const systemMessage = input.find((message) => message?.role === "system") || null;
  const nonSystem = input.filter((message) => message?.role !== "system");
  const headCount = firstExchangeCount(nonSystem);
  const tailBudgetBaseTokens = force ? Math.min(thresholdTokens, beforeTokens) : thresholdTokens;
  const tailStart = tailStartIndex(nonSystem, headCount, tailBudgetBaseTokens);
  if (tailStart <= headCount) {
    return unchanged(input, beforeTokens, "not_enough_history");
  }

  const head = nonSystem.slice(0, headCount).filter((message) => !isCompactionMessage(message));
  const middle = nonSystem.slice(headCount, tailStart);
  const tailWithPossibleSummaries = nonSystem.slice(tailStart);
  const targetTailCount = Math.min(MIN_TAIL_MESSAGES, Math.max(0, nonSystem.length - headCount));
  while (
    tailWithPossibleSummaries.filter((message) => !isCompactionMessage(message)).length < targetTailCount &&
    middle.length
  ) {
    tailWithPossibleSummaries.unshift(middle.pop());
  }
  const tail = tailWithPossibleSummaries.filter((message) => !isCompactionMessage(message));
  if (!middle.length) return unchanged(input, beforeTokens, "not_enough_history");

  const previousSummaries = input.filter(isCompactionMessage);
  const summaryInput = middle.map(pruneMessageForCompactionInput);
  try {
    const summarize =
      typeof options.summarize === "function"
        ? options.summarize
        : summarizeWithOpenAICompatibleProvider;
    const summary = await summarize({
      cfg,
      messages: summaryInput,
      previousSummaries,
      thresholdTokens,
      beforeTokens,
    });
    const nextMessages = [
      ...(systemMessage ? [systemMessage] : []),
      ...head,
      { role: "assistant", content: normalizeSummaryContent(summary) },
      ...tail,
    ];
    const afterTokens = estimateMessagesTokens(nextMessages);
    await logDebugEvent("context_compaction_ok", {
      forced: force,
      beforeTokens,
      afterTokens,
      beforeMessages: input.length,
      afterMessages: nextMessages.length,
      middleMessages: middle.length,
      previousSummaries: previousSummaries.length,
    }).catch(() => {});
    return {
      messages: nextMessages,
      changed: true,
      beforeTokens,
      afterTokens,
      beforeMessages: input.length,
      afterMessages: nextMessages.length,
      reason: force ? "forced" : "threshold",
    };
  } catch (error) {
    const warning = "Context compaction failed; history unchanged.";
    await logDebugEvent("context_compaction_failed", {
      forced: force,
      beforeTokens,
      beforeMessages: input.length,
      error: errorMessage(error),
    }).catch(() => {});
    if (typeof options.onWarning === "function") {
      try {
        await options.onWarning(warning, error);
      } catch {
        /* ignore warning delivery failures */
      }
    }
    return unchanged(input, beforeTokens, "summary_failed", {
      warning,
      error,
    });
  }
}

export function formatCompactionNotice(result) {
  return `Compacted context: ${result.beforeTokens} -> ${result.afterTokens} tokens, ${result.beforeMessages} -> ${result.afterMessages} messages.`;
}

export async function maybeCompactHistory(messages, cfg, options = {}) {
  return compactMessages(messages, cfg, { ...options, force: false });
}

export async function compactHistory(messages, cfg, options = {}) {
  return compactMessages(messages, cfg, { ...options, force: true });
}
