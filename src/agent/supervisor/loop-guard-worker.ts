/**
 * Dedicated worker: isolates ONNX/WASM so a bad run can be recovered by terminating the worker.
 */
/// <reference lib="webworker" />
import { LOOP_GUARD_HYPOTHESES } from "./prompts.js";
import type { SupervisorScores } from "./thresholds.js";
import {
  ensureTransformersEnv,
  formatTransformersError,
  LOOP_GUARD_MODEL_PATH,
} from "./transformers-env.js";

const MODEL_ID = LOOP_GUARD_MODEL_PATH;

type ZeroShotClassifier = (
  text: string,
  labels: string[],
  options?: { multi_label?: boolean }
) => Promise<{ labels: string[]; scores: number[] }>;

let classifierPromise: Promise<ZeroShotClassifier> | null = null;

function resetClassifier(): void {
  classifierPromise = null;
}

async function getClassifier(): Promise<ZeroShotClassifier> {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      await ensureTransformersEnv();
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("zero-shot-classification", MODEL_ID, {
        device: "wasm",
        dtype: "q8",
      });
      return pipe as unknown as ZeroShotClassifier;
    })().catch((err) => {
      resetClassifier();
      throw err;
    });
  }
  return classifierPromise;
}

/** One hypothesis per forward pass — lower peak WASM memory than multi_label batching. */
async function scorePremise(premise: string): Promise<SupervisorScores> {
  const classifier = await getClassifier();
  const text = premise.trim() || " ";
  const scores: SupervisorScores = { continue: 0, stop: 0, ask_user: 0 };
  const entries = Object.entries(LOOP_GUARD_HYPOTHESES) as Array<
    [keyof SupervisorScores, string]
  >;
  for (const [key, label] of entries) {
    const out = await classifier(text, [label], { multi_label: false });
    scores[key] = Number(out.scores[0] ?? 0);
  }
  return scores;
}

type WorkerIn =
  | { type: "init" }
  | { type: "reset" }
  | { type: "score"; requestId: string; premise: string };

type WorkerOut =
  | { type: "ready" }
  | { type: "reset_done" }
  | { type: "result"; requestId: string; scores: SupervisorScores }
  | { type: "error"; requestId?: string; error: string };

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  void (async () => {
    try {
      if (msg.type === "init") {
        await getClassifier();
        (self as DedicatedWorkerGlobalScope).postMessage({ type: "ready" } satisfies WorkerOut);
        return;
      }
      if (msg.type === "reset") {
        resetClassifier();
        (self as DedicatedWorkerGlobalScope).postMessage({ type: "reset_done" } satisfies WorkerOut);
        return;
      }
      if (msg.type === "score") {
        const scores = await scorePremise(msg.premise);
        (self as DedicatedWorkerGlobalScope).postMessage({
          type: "result",
          requestId: msg.requestId,
          scores,
        } satisfies WorkerOut);
      }
    } catch (e) {
      const error = formatTransformersError(e);
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "error",
        requestId: msg.type === "score" ? msg.requestId : undefined,
        error,
      } satisfies WorkerOut);
    }
  })();
};
