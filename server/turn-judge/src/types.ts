export type TurnJudgeAction = "continue" | "stop" | "ask_user";

export type TurnJudgeRequest = {
  conversationId?: string;
  turnId?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  toolState: {
    executedToolsInTurn: boolean;
    lastToolNames: string[];
    pendingToolNames?: string[];
    lastToolErrorCount: number;
    totalToolCallsInTurn: number;
    webSearchCount?: number;
    webFetchCount?: number;
  };
  runtimeState: {
    round: number;
    maxRounds: number;
    autoContinueNudges: number;
    maxAutoContinueNudges: number;
    textOnly: boolean;
    planMode: boolean;
    suppressTopicPivot?: boolean;
    approvedPlanGoal?: string;
  };
};

export type TurnJudgeResponse = {
  action: TurnJudgeAction;
  confidence: number;
  reason: string;
  source: "model" | "fallback" | "safety" | "error";
  latencyMs: number;
};
