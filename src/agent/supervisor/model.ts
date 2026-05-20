import { LOOP_GUARD_HYPOTHESES } from "./prompts.js";
import type { SupervisorScores } from "./thresholds.js";
import { ensureTransformersEnv, LOOP_GUARD_MODEL_PATH } from "./transformers-env.js";

const MODEL_ID = LOOP_GUARD_MODEL_PATH;

type ZeroShotClassifier = (
  text: string,
  labels: string[],
  options?: { multi_label?: boolean }
) => Promise<{ labels: string[]; scores: number[] }>;

let classifierPromise: Promise<ZeroShotClassifier> | null = null;

async function getClassifier(): Promise<ZeroShotClassifier> {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      await ensureTransformersEnv();
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("zero-shot-classification", MODEL_ID);
      return pipe as unknown as ZeroShotClassifier;
    })().catch((err) => {
      classifierPromise = null;
      throw err;
    });
  }
  return classifierPromise;
}

/** Warm-load the classifier off the critical path. Safe to call multiple times. */
export function prefetchClassifier(): void {
  void getClassifier().catch(() => {});
}

export async function scoreHypotheses(premise: string): Promise<SupervisorScores> {
  const classifier = await getClassifier();
  const labels = [
    LOOP_GUARD_HYPOTHESES.continue,
    LOOP_GUARD_HYPOTHESES.stop,
    LOOP_GUARD_HYPOTHESES.ask_user,
  ];
  const out = await classifier(premise, labels, { multi_label: true });
  const scores: SupervisorScores = { continue: 0, stop: 0, ask_user: 0 };
  for (let i = 0; i < out.labels.length; i++) {
    const label = out.labels[i];
    const score = Number(out.scores[i] ?? 0);
    if (label === LOOP_GUARD_HYPOTHESES.continue) scores.continue = score;
    else if (label === LOOP_GUARD_HYPOTHESES.stop) scores.stop = score;
    else if (label === LOOP_GUARD_HYPOTHESES.ask_user) scores.ask_user = score;
  }
  return scores;
}
