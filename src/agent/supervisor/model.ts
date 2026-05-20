import { LOOP_GUARD_PREMISE_MAX_CHARS, tailText } from "./prompts.js";
import { formatTransformersError } from "./transformers-env.js";
import type { SupervisorScores } from "./thresholds.js";
import {
  prefetchLoopGuardWorker,
  resetLoopGuardClassifier,
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
const ONNX_ERROR_RE = /ONNX Runtime Web error \d+/;

async function recoverFromScoreError(): Promise<void> {
  try {
    await resetLoopGuardClassifier();
  } catch {
    await restartLoopGuardWorker();
  }
}

async function scoreWithRecovery(premise: string): Promise<SupervisorScores> {
  const base = premise.trim() || " ";
  let lastError: unknown;
  let lastErrorKey = "";
  let repeatSame = 0;
  for (const maxChars of PREMISE_BUDGETS) {
    const text = tailText(base, maxChars);
    const maxAttempts =
      repeatSame >= 1 && ONNX_ERROR_RE.test(lastErrorKey) ? 2 : ATTEMPTS_PER_BUDGET;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await scorePremiseInWorker(text);
      } catch (err) {
        lastError = err;
        const key = formatTransformersError(err);
        repeatSame = key === lastErrorKey ? repeatSame + 1 : 1;
        lastErrorKey = key;
        if (repeatSame >= 2) break;
        await recoverFromScoreError();
      }
    }
    if (repeatSame >= 2) break;
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
