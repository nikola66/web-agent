export type AgentDecision = "continue" | "stop" | "ask_user";

export type SupervisorScores = {
  continue: number;
  stop: number;
  ask_user: number;
};

export type SupervisorResult = {
  decision: AgentDecision;
  scores: SupervisorScores;
  reason?: string;
};

export type LoopGuardThresholds = {
  maxMessages: number;
  stopThreshold: number;
  askUserThreshold: number;
  continueThreshold: number;
  fallbackDecision: AgentDecision;
};

export const LOOP_GUARD_DEFAULTS: LoopGuardThresholds = {
  maxMessages: 6,
  stopThreshold: 0.62,
  askUserThreshold: 0.6,
  continueThreshold: 0.58,
  fallbackDecision: "stop",
};

export function decideFromScores(
  scores: SupervisorScores,
  thresholds: LoopGuardThresholds = LOOP_GUARD_DEFAULTS
): AgentDecision {
  if (scores.stop >= thresholds.stopThreshold) return "stop";
  if (scores.ask_user >= thresholds.askUserThreshold) return "ask_user";
  if (scores.continue >= thresholds.continueThreshold) return "continue";
  return thresholds.fallbackDecision;
}
