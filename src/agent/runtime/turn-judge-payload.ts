import type { TurnJudgeDecision } from "./turn-judge-client.js";

export function buildTurnJudgePayload(opts: {
  conv: Array<{ role?: string; content?: unknown }>;
  executedToolsInTurn: boolean;
  autoContinueNudges: number;
  maxAutoContinueNudges: number;
  webSearchCountInTurn: number;
  webFetchCountInTurn: number;
  lastToolExecutions: Array<Record<string, unknown>>;
  pendingToolNames?: string[];
  round: number;
  maxRounds: number;
  textOnly: boolean;
  planMode: boolean;
  suppressTopicPivot?: boolean;
  approvedPlanGoal: string | null;
  totalToolCallsInTurn: number;
}) {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const row of opts.conv.slice(-10)) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const c = typeof row.content === "string" ? row.content : "";
    messages.push({
      role: row.role as "user" | "assistant",
      content: c.slice(0, 4000),
    });
  }
  const trimmed = messages.slice(-4);

  const lastToolNames = opts.lastToolExecutions
    .map((e) => String((e as { tool?: string })?.tool ?? ""))
    .filter(Boolean)
    .slice(-12);

  let lastToolErrorCount = 0;
  for (const e of opts.lastToolExecutions) {
    if (e && typeof e === "object" && (e as { error?: unknown }).error) lastToolErrorCount++;
  }

  return {
    messages: trimmed,
    toolState: {
      executedToolsInTurn: opts.executedToolsInTurn,
      lastToolNames,
      pendingToolNames: opts.pendingToolNames,
      lastToolErrorCount,
      totalToolCallsInTurn: opts.totalToolCallsInTurn,
      webSearchCount: opts.webSearchCountInTurn,
      webFetchCount: opts.webFetchCountInTurn,
    },
    runtimeState: {
      round: opts.round,
      maxRounds: opts.maxRounds,
      autoContinueNudges: opts.autoContinueNudges,
      maxAutoContinueNudges: opts.maxAutoContinueNudges,
      textOnly: opts.textOnly,
      planMode: opts.planMode,
      suppressTopicPivot: opts.suppressTopicPivot === true,
      approvedPlanGoal: opts.approvedPlanGoal ?? undefined,
    },
  };
}

export function buildGenericContinuationNudge(originalUserInput: string, decision: TurnJudgeDecision): string {
  return [
    `Continue the user's latest request now.`,
    `Latest request: ${JSON.stringify(originalUserInput)}`,
    `Decision reason: ${decision.reason}`,
    ``,
    `Take the next concrete action. Use tools if needed. If the request is complete, provide the final answer and stop.`,
  ].join("\n");
}
