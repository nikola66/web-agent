import { BLOCK_CONTINUATION_PREFIX } from "./terminal-format.js";
import { stripAnsi } from "./utils.js";

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

export function formatTranscriptEventForChannel(event) {
  const kind = String(event?.type || "");
  if (kind === "assistant") {
    return formatAssistantTranscript({
      agentName: event.agentName,
      text: event.text,
      renderedText: event.renderedText,
      branchBelowName: event.branchBelowName !== false,
    });
  }
  if (kind === "tool_start") return formatToolStartTranscript(event);
  if (kind === "tool_result") return formatToolResultTranscript(event);
  if (kind === "system_line") return String(event.text || "").trimEnd();
  return "";
}
