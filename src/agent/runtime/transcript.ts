import { BLOCK_CONTINUATION_PREFIX } from "./terminal-format.js";
import { stripAnsi } from "./utils.js";

export type ChannelTranscriptStyle = "terminal" | "telegram";

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

function prefixPlainBlock(text, branchBelowName = true) {
  const lines = String(text || "").trimEnd().split("\n");
  const firstPrefix = branchBelowName ? " ⎿ " : BLOCK_CONTINUATION_PREFIX;
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
} = {}) {
  const name = String(agentName || "Agent").trim() || "Agent";
  const renderedBody = typeof renderedText === "string" ? stripAnsi(renderedText).trimEnd() : "";
  const body = renderedBody || prefixPlainBlock(text, branchBelowName);
  return `${name}\n${body}`.trimEnd();
}

export function formatToolStartTranscript({ name, argsPreview = "{}", argsPreviewTruncated = false } = {}) {
  const toolName = String(name || "unknown").trim() || "unknown";
  return `▸ ${toolName} ${String(argsPreview || "{}")}${argsPreviewTruncated ? "…" : ""}`;
}

export function formatToolResultTranscript({ name, status = "ok", error = "" } = {}) {
  const toolName = String(name || "unknown").trim() || "unknown";
  if (status === "denied") return `⊘ ${toolName} denied by user`;
  if (status === "error") return `✗ ${toolName}: ${String(error || "error")}`;
  return `✓ ${toolName}`;
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

export function createSystemLineTranscriptEvent({ round, text } = {}) {
  return {
    type: "system_line",
    critical: false,
    round,
    text,
  };
}

export function createGoalLoopTranscriptEvent({
  phase,
  goal = "",
  reason = "",
  continuationsUsed = 0,
  maxContinuations = 20,
  round,
} = {}) {
  return {
    type: "goal_loop",
    critical: false,
    phase,
    goal,
    reason,
    continuationsUsed,
    maxContinuations,
    round,
  };
}

export function formatGoalLoopTranscript(
  event,
  options?: {
    style?: ChannelTranscriptStyle;
  }
) {
  const style = options?.style ?? "terminal";
  const phase = String(event?.phase || "").trim();
  const goalPreview = stripAnsi(String(event?.goal || "").trim()).slice(0, 220);
  const reason = stripAnsi(String(event?.reason || "").trim()).slice(0, 180);
  const used = Number(event?.continuationsUsed ?? 0);
  const maxC = Number(event?.maxContinuations ?? 20) || 20;
  let line = "";
  if (phase === "invoked") {
    line = goalPreview ? `◇ Plan goal · active — ${goalPreview}` : `◇ Plan goal · active`;
  } else if (phase === "continue") {
    line = `◇ Plan goal · continuing (${used}/${maxC})`;
    if (goalPreview) line += ` — ${goalPreview}`;
  } else if (phase === "done") {
    line = `◇ Plan goal · done`;
    if (reason) line += ` — ${reason}`;
  } else if (phase === "paused") {
    line =
      reason === "budget"
        ? `◇ Plan goal · paused (continuation budget ${maxC})`
        : `◇ Plan goal · paused`;
    if (reason && reason !== "budget") line += ` — ${reason}`;
  } else {
    line = `◇ Plan goal · ${phase || "update"}`;
  }
  line = stripAnsi(line).trimEnd();
  if (!line) return "";
  return style === "telegram" ? line.slice(0, 3800) : line;
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
    if (style === "telegram") {
      const toolName = String(event?.name || "unknown").trim() || "unknown";
      const em = toolEmojiFromCatalog(catalog, toolName);
      return em ? `▸ ${em} ${toolName}` : `▸ ${toolName}`;
    }
    return formatToolStartTranscript(event);
  }
  if (kind === "tool_result") {
    if (style === "telegram") {
      const toolName = String(event?.name || "unknown").trim() || "unknown";
      const em = toolEmojiFromCatalog(catalog, toolName);
      const prefix = em ? `${em} ` : "";
      const status = String(event?.status || "ok");
      if (status === "denied") return `⊘ ${prefix}${toolName}`;
      if (status === "error")
        return `✗ ${prefix}${toolName}: ${String(event?.error || "error").slice(0, 200)}`;
      return `✓ ${prefix}${toolName}`;
    }
    return formatToolResultTranscript(event);
  }
  if (kind === "system_line") {
    if (style === "telegram") return "";
    return String(event.text || "").trimEnd();
  }
  if (kind === "goal_loop") {
    return formatGoalLoopTranscript(event, { style });
  }
  return "";
}
