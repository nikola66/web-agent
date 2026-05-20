import {
  buildSupervisorPremise,
  LOOP_GUARD_HYPOTHESES,
  type LoopGuardMeta,
  type LoopGuardPhase,
  type SupervisorMessage,
  LOOP_GUARD_PREMISE_FRAME,
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

export type {
  AgentDecision,
  LoopGuardMeta,
  LoopGuardPhase,
  LoopGuardThresholds,
  SupervisorMessage,
  SupervisorResult,
  SupervisorScores,
};
export {
  LOOP_GUARD_DEFAULTS,
  LOOP_GUARD_HYPOTHESES,
  LOOP_GUARD_PREMISE_FRAME,
  buildSupervisorPremise,
  decideFromScores,
  prefetchClassifier,
};

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
  try {
    const scores = await scoreHypotheses(premise);
    const decision = decideFromScores(scores, thresholds);
    return { decision, scores };
  } catch (e) {
    const error = formatTransformersError(e);
    return {
      decision: "continue",
      scores: { continue: 0, stop: 0, ask_user: 0 },
      reason: "scoring_unavailable",
      error,
    };
  }
}
