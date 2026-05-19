import {
  buildSupervisorPremise,
  LOOP_GUARD_HYPOTHESES,
  type LoopGuardMeta,
  type SupervisorMessage,
} from "./prompts.js";
import { scoreHypotheses } from "./model.js";
import {
  decideFromScores,
  LOOP_GUARD_DEFAULTS,
  type AgentDecision,
  type LoopGuardThresholds,
  type SupervisorResult,
  type SupervisorScores,
} from "./thresholds.js";

export type { AgentDecision, LoopGuardMeta, LoopGuardThresholds, SupervisorMessage, SupervisorResult, SupervisorScores };
export { LOOP_GUARD_DEFAULTS, LOOP_GUARD_HYPOTHESES, buildSupervisorPremise, decideFromScores };

export type DecideInput = {
  messages: SupervisorMessage[];
  maxMessages?: number;
  meta?: LoopGuardMeta;
  thresholds?: Partial<LoopGuardThresholds>;
};

export async function decide({
  messages,
  maxMessages = LOOP_GUARD_DEFAULTS.maxMessages,
  meta = {},
  thresholds: thresholdOverrides = {},
}: DecideInput): Promise<SupervisorResult> {
  const thresholds = { ...LOOP_GUARD_DEFAULTS, ...thresholdOverrides };
  const premise = buildSupervisorPremise(messages, maxMessages, meta);
  const scores = await scoreHypotheses(premise);
  const decision = decideFromScores(scores, thresholds);
  return { decision, scores };
}
