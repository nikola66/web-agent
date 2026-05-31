import { BLOCK_CONTINUATION_PREFIX } from "./terminal-format.js";
import { stripAnsi } from "./utils.js";

export type ChannelTranscriptStyle = "terminal" | "telegram";
export type TurnSignalEventType =
  | "turn_status"
  | "continuation"
  | "context_pressure"
  | "tool_batch_start"
  | "tool_batch_end"
  | "blocked";

export function shortenReasoningPreview(text: string, maxChars = 180): string {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `…${normalized.slice(-(maxChars - 1))}`;
}

function normalizeToolEmoji(emoji: string) {
  return String(emoji || "").replace(/([\p{Extended_Pictographic}])\s+(\uFE0F)/gu, "$1$2");
}

function toolEmojiFromCatalog(
  catalog: Record<string, { emoji?: string } | undefined> | undefined,
  toolName: string
) {
  const raw = catalog?.[toolName]?.emoji;
  return normalizeToolEmoji(String(raw || "").trim());
}

function formatToolLabel(
  toolName: string,
  catalog?: Record<string, { emoji?: string } | undefined>
) {
  const em = toolEmojiFromCatalog(catalog, toolName);
  return em ? `${em} ${toolName}` : toolName;
}

function prefixPlainBlock(text, branchBelowName = true) {
  const lines = String(text || "").trimEnd().split("\n");
  const firstPrefix = branchBelowName ? " └ " : BLOCK_CONTINUATION_PREFIX;
  return lines.map((line, i) => {
    if (i === 0) return `${firstPrefix}${line}`;
    return line.trim() ? `${BLOCK_CONTINUATION_PREFIX}${line}` : "";
  }).join("\n");
}

export function formatAssistantTranscript({
  agentName,
  text,
  renderedText,
  branchBelowName = true,
}: AssistantTranscriptEventInput = {}) {
  const name = String(agentName || "Agent").trim() || "Agent";
  const renderedBody = typeof renderedText === "string" ? stripAnsi(renderedText).trimEnd() : "";
  const body = renderedBody || prefixPlainBlock(text, branchBelowName);
  return `${name}\n${body}`.trimEnd();
}

export function formatToolStartTranscript({
  name,
  argsPreview = "{}",
  argsPreviewTruncated = false,
  toolCatalog,
  omitArgsPreview = false,
}: ToolStartTranscriptEventInput = {}) {
  const toolName = String(name || "unknown").trim() || "unknown";
  const label = formatToolLabel(toolName, toolCatalog);
  if (omitArgsPreview) return `▸ ${label}`;
  return `▸ ${label} ${String(argsPreview || "{}")}${argsPreviewTruncated ? "…" : ""}`;
}

export function formatToolResultTranscript({
  name,
  status = "ok",
  error = "",
  toolCatalog,
  maxErrorLength,
}: ToolResultTranscriptEventInput = {}) {
  const toolName = String(name || "unknown").trim() || "unknown";
  const label = formatToolLabel(toolName, toolCatalog);
  if (status === "denied") return `⊘ ${label} denied by user`;
  if (status === "error") {
    let msg = String(error || "error");
    if (maxErrorLength && msg.length > maxErrorLength) msg = msg.slice(0, maxErrorLength);
    return `✗ ${label}: ${msg}`;
  }
  return `✓ ${label}`;
}

export function formatSkippedToolsTranscript(
  rejected: Array<{ reason?: string; call?: unknown }> = []
) {
  const reasons = (Array.isArray(rejected) ? rejected : [])
    .map((entry) => String(entry?.reason || "").trim())
    .filter(Boolean);
  const suffix = reasons.length ? `: ${reasons.join(", ")}` : "";
  return `▸ skipped ${reasons.length || 1} invalid tool call(s)${suffix}`;
}

export type AssistantTranscriptEventInput = {
  round?: number;
  agentName?: string;
  text?: string;
  renderedText?: string;
  branchBelowName?: boolean;
};

export function createAssistantTranscriptEvent({
  round,
  agentName,
  text,
  renderedText,
  branchBelowName = true,
}: AssistantTranscriptEventInput = {}) {
  return {
    type: "assistant",
    critical: true,
    round,
    agentName,
    text,
    renderedText,
    branchBelowName,
  };
}

export type ToolStartTranscriptEventInput = {
  name?: string;
  argsPreview?: string;
  argsPreviewTruncated?: boolean;
  toolCatalog?: Record<string, { emoji?: string } | undefined>;
  omitArgsPreview?: boolean;
};

export function createToolStartTranscriptEvent({
  name,
  argsPreview = "{}",
  argsPreviewTruncated = false,
}: ToolStartTranscriptEventInput = {}) {
  return {
    type: "tool_start",
    critical: false,
    name,
    argsPreview,
    argsPreviewTruncated,
  };
}

export type ToolResultTranscriptEventInput = {
  name?: string;
  status?: string;
  error?: string;
  toolCatalog?: Record<string, { emoji?: string } | undefined>;
  maxErrorLength?: number;
};

export function createToolResultTranscriptEvent({
  name,
  status = "ok",
  error = "",
}: ToolResultTranscriptEventInput = {}) {
  return {
    type: "tool_result",
    critical: false,
    name,
    status,
    error,
  };
}

export function createSystemLineTranscriptEvent({
  round,
  text,
}: SystemLineTranscriptEventInput = {}) {
  return {
    type: "system_line",
    critical: false,
    round,
    text,
  };
}

export type ReasoningPreviewTranscriptEventInput = {
  round?: number;
  text?: string;
  done?: boolean;
};

export function createReasoningPreviewTranscriptEvent({
  round,
  text,
  done = false,
}: ReasoningPreviewTranscriptEventInput = {}) {
  return {
    type: "reasoning_preview",
    critical: false,
    round,
    text,
    done,
  };
}

export type SystemLineTranscriptEventInput = {
  round?: number;
  text?: string;
};

export type TurnSignalTranscriptEventInput = {
  signal?: TurnSignalEventType;
  round?: number;
  text?: string;
  reason?: string;
  toolCount?: number;
  toolName?: string;
};

export function createTurnSignalTranscriptEvent({
  signal = "turn_status",
  round,
  text,
  reason,
  toolCount,
  toolName,
}: TurnSignalTranscriptEventInput = {}) {
  return {
    type: "turn_signal",
    critical: false,
    signal,
    round,
    text,
    reason,
    toolCount,
    toolName,
  };
}

function formatTurnSignal(event, style: ChannelTranscriptStyle): string {
  const signal = String(event?.signal || "turn_status");
  const reason = String(event?.reason || "").trim();
  const text = String(event?.text || "").trim();
  const toolName = String(event?.toolName || "").trim();
  const toolCount = Number(event?.toolCount || 0);
  if (signal === "turn_status") return style === "telegram" ? text : "";
  if (signal === "continuation") {
    return text || `Continuing${reason ? `: ${reason}` : ""}…`;
  }
  if (signal === "context_pressure") {
    return text || "Context pressure high; compacting/pruning as needed.";
  }
  if (signal === "tool_batch_start") {
    if (text) return text;
    if (toolCount > 1) return `Working: running ${toolCount} tools…`;
    return `Working: ${toolName || "tool"}…`;
  }
  if (signal === "tool_batch_end") {
    return text || "Continuing after tool results…";
  }
  if (signal === "blocked") {
    return text || `Blocked${reason ? `: ${reason}` : ""}`;
  }
  return text;
}

export function formatTranscriptEventForChannel(
  event,
  options?: {
    style?: ChannelTranscriptStyle;
    toolCatalog?: Record<string, { emoji?: string } | undefined>;
  }
) {
  const style = options?.style ?? "terminal";
  const catalog = options?.toolCatalog;
  const kind = String(event?.type || "");
  if (kind === "assistant") {
    if (style === "telegram") {
      return stripAnsi(String(event?.text ?? "")).trimEnd();
    }
    return formatAssistantTranscript({
      agentName: event.agentName,
      text: event.text,
      renderedText: event.renderedText,
      branchBelowName: event.branchBelowName !== false,
    });
  }
  if (kind === "tool_start") {
    return formatToolStartTranscript({
      name: event?.name,
      argsPreview: event?.argsPreview,
      argsPreviewTruncated: event?.argsPreviewTruncated,
      toolCatalog: catalog,
      omitArgsPreview: style === "telegram",
    });
  }
  if (kind === "tool_result") {
    return formatToolResultTranscript({
      name: event?.name,
      status: event?.status,
      error: event?.error,
      toolCatalog: catalog,
      maxErrorLength: style === "telegram" ? 200 : undefined,
    });
  }
  if (kind === "system_line") {
    if (style === "telegram") return "";
    return String(event.text || "").trimEnd();
  }
  if (kind === "turn_signal") {
    return formatTurnSignal(event, style);
  }
  if (kind === "reasoning_preview") {
    const preview = shortenReasoningPreview(
      String(event?.text ?? ""),
      style === "telegram" ? 480 : 180
    );
    if (!preview) return "";
    if (style === "telegram") return `_💭 ${preview}_`;
    return `💭 ${preview}`;
  }
  return "";
}
