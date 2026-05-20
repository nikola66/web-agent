import { WHISPER_SAMPLE_RATE } from "./audio-decode.js";

type WorkerIn =
  | { type: "init" }
  | { type: "transcribe"; requestId: string; samples: Float32Array; sampleRate: number };

type WorkerOut =
  | { type: "ready" }
  | { type: "result"; requestId: string; text: string }
  | { type: "error"; requestId?: string; error: string };

const STT_TIMEOUT_MS = 90_000;

let worker: Worker | null = null;
let readyPromise: Promise<void> | null = null;
const pending = new Map<
  string,
  { resolve: (text: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

function nextRequestId(): string {
  return `stt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function terminateWorker(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error("STT worker terminated"));
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
    if (msg.type === "ready") return;
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
      entry.resolve(msg.text);
    }
  };
  w.onerror = () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("STT worker crashed"));
    }
    pending.clear();
    worker = null;
    readyPromise = null;
  };
}

function spawnWorker(): Worker {
  const w = new Worker(new URL("./stt-worker.ts", import.meta.url), { type: "module" });
  attachWorker(w);
  return w;
}

function post(msg: WorkerIn): void {
  if (!worker) throw new Error("STT worker not started");
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
        reject(new Error("STT worker init timed out"));
      }, STT_TIMEOUT_MS);
      worker!.addEventListener("message", onReady);
      post({ type: "init" });
    });
  })().catch((err) => {
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

export async function prefetchStt(): Promise<void> {
  await ensureReady();
}

export async function transcribe(
  samples: Float32Array,
  sampleRate = WHISPER_SAMPLE_RATE
): Promise<string> {
  await ensureReady();
  const requestId = nextRequestId();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("STT transcribe timed out"));
    }, STT_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    worker!.postMessage({ type: "transcribe", requestId, samples, sampleRate });
  });
}

export async function transcribeBlob(blob: Blob): Promise<string> {
  const { decodeBlobToMono16k } = await import("./audio-decode.js");
  const samples = await decodeBlobToMono16k(blob);
  return transcribe(samples, WHISPER_SAMPLE_RATE);
}

export async function transcribeBytes(bytes: Uint8Array, mimeHint?: string): Promise<string> {
  const { decodeBytesToMono16k } = await import("./audio-decode.js");
  const samples = await decodeBytesToMono16k(bytes, mimeHint);
  return transcribe(samples, WHISPER_SAMPLE_RATE);
}
