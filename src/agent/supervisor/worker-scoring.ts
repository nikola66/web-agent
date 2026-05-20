import type { SupervisorScores } from "./thresholds.js";

type WorkerIn =
  | { type: "init" }
  | { type: "reset" }
  | { type: "score"; requestId: string; premise: string };

type WorkerOut =
  | { type: "ready" }
  | { type: "reset_done" }
  | { type: "result"; requestId: string; scores: SupervisorScores }
  | { type: "error"; requestId?: string; error: string };

const SCORE_TIMEOUT_MS = 90_000;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
const pending = new Map<
  string,
  { resolve: (scores: SupervisorScores) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function nextRequestId(): string {
  return `lg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function terminateWorker(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("loop-guard worker terminated"));
  }
  pending.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
  readyPromise = null;
}

function attachWorker(w: Worker): void {
  w.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const msg = ev.data;
    if (msg.type === "ready" || msg.type === "reset_done") return;
    if (msg.type === "error") {
      if (!msg.requestId) return;
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      entry.reject(new Error(msg.error));
      return;
    }
    if (msg.type === "result") {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      entry.resolve(msg.scores);
    }
  };
  w.onerror = () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("loop-guard worker crashed"));
    }
    pending.clear();
    worker = null;
    readyPromise = null;
  };
}

function spawnWorker(): Worker {
  const w = new Worker(new URL("./loop-guard-worker.ts", import.meta.url), { type: "module" });
  attachWorker(w);
  return w;
}

function post(msg: WorkerIn): void {
  if (!worker) throw new Error("loop-guard worker not started");
  worker.postMessage(msg);
}

async function ensureReady(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    terminateWorker();
    worker = spawnWorker();
    await new Promise<void>((resolve, reject) => {
      const onReady = (ev: MessageEvent<WorkerOut>) => {
        if (ev.data.type === "ready") {
          worker?.removeEventListener("message", onReady);
          clearTimeout(timer);
          resolve();
        } else if (ev.data.type === "error" && !ev.data.requestId) {
          worker?.removeEventListener("message", onReady);
          clearTimeout(timer);
          reject(new Error(ev.data.error));
        }
      };
      const timer = setTimeout(() => {
        worker?.removeEventListener("message", onReady);
        reject(new Error("loop-guard worker init timed out"));
      }, SCORE_TIMEOUT_MS);
      worker!.addEventListener("message", onReady);
      post({ type: "init" });
    });
  })().catch((err) => {
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

export async function resetLoopGuardClassifier(): Promise<void> {
  await ensureReady();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker?.removeEventListener("message", onMsg);
      reject(new Error("loop-guard worker reset timed out"));
    }, SCORE_TIMEOUT_MS);
    const onMsg = (ev: MessageEvent<WorkerOut>) => {
      if (ev.data.type === "reset_done") {
        worker?.removeEventListener("message", onMsg);
        clearTimeout(timer);
        resolve();
      } else if (ev.data.type === "error" && !ev.data.requestId) {
        worker?.removeEventListener("message", onMsg);
        clearTimeout(timer);
        reject(new Error(ev.data.error));
      }
    };
    worker!.addEventListener("message", onMsg);
    post({ type: "reset" });
  });
}

export async function restartLoopGuardWorker(): Promise<void> {
  terminateWorker();
  await ensureReady();
}

export async function scorePremiseInWorker(premise: string): Promise<SupervisorScores> {
  await ensureReady();
  const requestId = nextRequestId();
  return new Promise<SupervisorScores>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("loop-guard worker score timed out"));
    }, SCORE_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    post({ type: "score", requestId, premise });
  });
}

export async function prefetchLoopGuardWorker(): Promise<void> {
  await ensureReady();
}
