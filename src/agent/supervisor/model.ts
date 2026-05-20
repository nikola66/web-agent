import { LOOP_GUARD_PREMISE_MAX_CHARS, tailText } from "./prompts.js";
import type { SupervisorScores } from "./thresholds.js";
import {
  prefetchLoopGuardWorker,
  restartLoopGuardWorker,
  scorePremiseInWorker,
} from "./worker-scoring.js";

let scoreChain: Promise<unknown> = Promise.resolve();

function enqueueScore<T>(fn: () => Promise<T>): Promise<T> {
  const run = scoreChain.then(fn, fn);
  scoreChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const PREMISE_BUDGETS = [LOOP_GUARD_PREMISE_MAX_CHARS, 1200, 800] as const;
const ATTEMPTS_PER_BUDGET = 3;

async function scoreWithRecovery(premise: string): Promise<SupervisorScores> {
  const base = premise.trim() || " ";
  let lastError: unknown;
  for (const maxChars of PREMISE_BUDGETS) {
    const text = tailText(base, maxChars);
    for (let attempt = 0; attempt < ATTEMPTS_PER_BUDGET; attempt++) {
      try {
        return await scorePremiseInWorker(text);
      } catch (err) {
        lastError = err;
        await restartLoopGuardWorker();
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "loop-guard scoring failed"));
}

/** Warm-load the classifier in an isolated worker. Safe to call multiple times. */
export async function prefetchClassifier(): Promise<void> {
  await prefetchLoopGuardWorker();
}

export async function scoreHypotheses(premise: string): Promise<SupervisorScores> {
  return enqueueScore(() => scoreWithRecovery(premise));
}
