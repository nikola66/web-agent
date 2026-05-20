import {
  buildSupervisorPremise,
  LOOP_GUARD_HYPOTHESES,
  type LoopGuardMeta,
  type SupervisorMessage,
} from "./prompts.js";
import { prefetchClassifier, scoreHypotheses } from "./model.js";
import { formatTransformersError } from "./transformers-env.js";
import {
  decideFromScores,
  LOOP_GUARD_DEFAULTS,
  type AgentDecision,
  type LoopGuardThresholds,
  type SupervisorResult,
  type SupervisorScores,
} from "./thresholds.js";

export type { AgentDecision, LoopGuardMeta, LoopGuardThresholds, SupervisorMessage, SupervisorResult, SupervisorScores };
export { LOOP_GUARD_DEFAULTS, LOOP_GUARD_HYPOTHESES, buildSupervisorPremise, decideFromScores, prefetchClassifier };

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
  try {
    const premise = buildSupervisorPremise(messages, maxMessages, meta);
    const scores = await scoreHypotheses(premise);
    const decision = decideFromScores(scores, thresholds);
    return { decision, scores };
  } catch (e) {
    const message = formatTransformersError(e);
    return {
      decision: "continue",
      scores: { continue: 0, stop: 0, ask_user: 0 },
      reason: "scoring_unavailable",
      error: message,
    };
  }
}
