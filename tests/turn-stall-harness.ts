import {
  extractClarifyMarkers,
  extractDsmlToolCallPayloads,
  extractJsonToolCallPayloads,
  extractLooseCallToolLines,
  extractLongcatToolCallPayloads,
  extractMarkerTools,
  extractPlainToolCommandLines,
  extractToolCallTagPayloads,
  normalizeToolCalls,
  sanitizeAssistantVisibleText,
} from "../dist/agent-runtime/llm/streaming.js";
import {
  shouldContinueApiDiscoveryStall,
  shouldContinueContentShareDeliverable,
  shouldContinueCronVerification,
  shouldContinueEmptyAfterTools,
  shouldContinueEmptyResponse,
  shouldContinueFindSkillsDelivery,
  shouldContinueIncompletePublishDeliverable,
  shouldContinueIncompleteTodos,
  shouldContinueIntermediateAck,
  shouldContinuePostToolStall,
  shouldContinuePreToolPromiseStall,
  shouldContinueSnapshotReadStall,
  shouldContinueThinkingPrefill,
  shouldContinueTruncation,
  shouldContinueUnparsedToolMarkup,
  resolveTurnStopReason,
} from "../dist/agent-runtime/turn-continuation.js";

export type ParsedAssistantRound = {
  tools: Array<{ name: string; arguments?: Record<string, unknown> }>;
  visible: string;
  rejected: Array<{ reason: string; call: unknown }>;
  combined: string;
};

/** Mirrors the tool parse chain in `turn.ts` (without native stream tool_calls). */
export function parseAssistantToolRound(
  combined: string,
  activeToolNames: string[],
  streamToolCalls: Array<{ name?: string; arguments?: unknown }> = []
): ParsedAssistantRound {
  const clarifyParsed = extractClarifyMarkers(combined);
  const markerParsed = extractMarkerTools(clarifyParsed.visible);
  const longcatParsed = extractLongcatToolCallPayloads(markerParsed.visible);
  const toolCallTagParsed = extractToolCallTagPayloads(longcatParsed.visible);
  const dsmlParsed = extractDsmlToolCallPayloads(toolCallTagParsed.visible);
  const nativeOrMarkerCount =
    streamToolCalls.length +
    markerParsed.tools.length +
    longcatParsed.tools.length +
    toolCallTagParsed.tools.length +
    dsmlParsed.tools.length;
  const jsonFallbackParsed =
    nativeOrMarkerCount === 0
      ? extractJsonToolCallPayloads(dsmlParsed.visible, activeToolNames)
      : { tools: [], visible: dsmlParsed.visible };
  const jsonFallbackCalls = jsonFallbackParsed.tools;
  const looseCallParsed =
    nativeOrMarkerCount === 0 && jsonFallbackCalls.length === 0
      ? extractLooseCallToolLines(jsonFallbackParsed.visible, activeToolNames)
      : { tools: [], visible: jsonFallbackParsed.visible };
  const plainCommandParsed =
    nativeOrMarkerCount === 0 &&
    jsonFallbackCalls.length === 0 &&
    looseCallParsed.tools.length === 0
      ? extractPlainToolCommandLines(looseCallParsed.visible, activeToolNames)
      : { tools: [], visible: looseCallParsed.visible };
  const rawToolCalls = [
    ...streamToolCalls.map((call) => ({
      name: String(call?.name || ""),
      arguments: call?.arguments ?? {},
    })),
    ...markerParsed.tools,
    ...longcatParsed.tools,
    ...toolCallTagParsed.tools,
    ...dsmlParsed.tools,
    ...jsonFallbackCalls,
    ...looseCallParsed.tools,
    ...plainCommandParsed.tools,
  ];
  const { normalized: tools, rejected } = normalizeToolCalls(rawToolCalls, activeToolNames);
  const visible = sanitizeAssistantVisibleText(plainCommandParsed.visible, activeToolNames);
  return { tools, visible, rejected, combined };
}

export type ContinuationCounts = {
  intermediateAck: number;
  emptyAfterTools: number;
  emptyResponse: number;
  unparsedMarkup: number;
  truncation: number;
  snapshotReadStall: number;
  contentShare: number;
  postToolStall: number;
  thinkingPrefill: number;
  apiDiscoveryStall: number;
  findSkillsDelivery: number;
  preToolPromise: number;
  cronVerify: number;
  incompleteTodos: number;
  incompletePublish: number;
};

export const ZERO_CONTINUATION_COUNTS: ContinuationCounts = {
  intermediateAck: 0,
  emptyAfterTools: 0,
  emptyResponse: 0,
  unparsedMarkup: 0,
  truncation: 0,
  snapshotReadStall: 0,
  contentShare: 0,
  postToolStall: 0,
  thinkingPrefill: 0,
  apiDiscoveryStall: 0,
  findSkillsDelivery: 0,
  preToolPromise: 0,
  cronVerify: 0,
  incompleteTodos: 0,
  incompletePublish: 0,
};

export type NoToolsContinuationInput = {
  combined: string;
  visible: string;
  toolsLength: number;
  executedToolsInTurn: boolean;
  originalUserInput: string;
  conv: Array<{ role?: string; content?: unknown }>;
  runToolCalls: Array<{ name: string }>;
  lastToolExecutions: Array<{ tool: string; result?: Record<string, unknown> }>;
  counts: ContinuationCounts;
  finishReason?: string | null;
  webDiscoveryCallsInTurn?: number;
  pendingCronRegisterIds?: string[];
  sawReasoning?: boolean;
  todoStats?: { total: number; completed: number; open: number };
};

export type NoToolsContinuationDecision =
  | { action: "continue"; kind: string }
  | { action: "stop"; stopReason: "completed" | "no_tools_no_continue" | "post_tool_no_continue" };

/** Mirrors the `if (!tools.length)` continuation chain in `turn.ts`. */
export function decideNoToolsContinuation(input: NoToolsContinuationInput): NoToolsContinuationDecision {
  const {
    combined,
    visible,
    toolsLength,
    executedToolsInTurn,
    originalUserInput,
    conv,
    runToolCalls,
    lastToolExecutions,
    counts,
    finishReason = "stop",
    webDiscoveryCallsInTurn = 0,
    pendingCronRegisterIds = [],
    sawReasoning = false,
    todoStats = { total: 0, completed: 0, open: 0 },
  } = input;

  if (toolsLength > 0) {
    throw new Error("decideNoToolsContinuation expects toolsLength === 0");
  }

  if (
    shouldContinueIntermediateAck(
      originalUserInput,
      visible,
      conv,
      executedToolsInTurn,
      counts.intermediateAck
    )
  ) {
    return { action: "continue", kind: "intermediate_ack" };
  }
  if (shouldContinueEmptyAfterTools(visible, executedToolsInTurn, counts.emptyAfterTools)) {
    return { action: "continue", kind: "empty_after_tools" };
  }
  if (
    shouldContinueThinkingPrefill(visible, sawReasoning, toolsLength, counts.thinkingPrefill)
  ) {
    return { action: "continue", kind: "thinking_prefill" };
  }
  if (shouldContinueEmptyResponse(visible, counts.emptyResponse)) {
    return { action: "continue", kind: "empty_response" };
  }
  if (shouldContinueUnparsedToolMarkup(combined, toolsLength, counts.unparsedMarkup)) {
    return { action: "continue", kind: "unparsed_tool_markup" };
  }
  if (shouldContinueTruncation(finishReason, counts.truncation)) {
    return { action: "continue", kind: "truncation" };
  }
  if (
    shouldContinueSnapshotReadStall(
      visible,
      executedToolsInTurn,
      lastToolExecutions,
      counts.snapshotReadStall
    )
  ) {
    return { action: "continue", kind: "snapshot_read_stall" };
  }
  if (
    shouldContinueContentShareDeliverable(
      originalUserInput,
      runToolCalls,
      executedToolsInTurn,
      visible,
      counts.contentShare,
      lastToolExecutions
    )
  ) {
    return { action: "continue", kind: "content_share" };
  }
  if (shouldContinuePostToolStall(visible, executedToolsInTurn, counts.postToolStall)) {
    return { action: "continue", kind: "post_tool_stall" };
  }
  if (
    shouldContinueApiDiscoveryStall(
      originalUserInput,
      visible,
      executedToolsInTurn,
      lastToolExecutions,
      counts.apiDiscoveryStall
    )
  ) {
    return { action: "continue", kind: "api_discovery_stall" };
  }
  if (
    shouldContinueFindSkillsDelivery(
      originalUserInput,
      visible,
      executedToolsInTurn,
      webDiscoveryCallsInTurn,
      counts.findSkillsDelivery
    )
  ) {
    return { action: "continue", kind: "find_skills_delivery" };
  }
  if (
    shouldContinuePreToolPromiseStall(visible, conv, executedToolsInTurn, counts.preToolPromise)
  ) {
    return { action: "continue", kind: "pre_tool_promise" };
  }
  if (shouldContinueCronVerification(pendingCronRegisterIds, counts.cronVerify)) {
    return { action: "continue", kind: "cron_verify" };
  }
  if (
    shouldContinueIncompleteTodos(
      originalUserInput,
      executedToolsInTurn,
      counts.incompleteTodos,
      todoStats,
      visible
    )
  ) {
    return { action: "continue", kind: "incomplete_todos" };
  }
  if (
    shouldContinueIncompletePublishDeliverable(
      originalUserInput,
      runToolCalls,
      executedToolsInTurn,
      visible,
      counts.incompletePublish
    )
  ) {
    return { action: "continue", kind: "incomplete_publish" };
  }

  return {
    action: "stop",
    stopReason: resolveTurnStopReason(visible, executedToolsInTurn),
  };
}
