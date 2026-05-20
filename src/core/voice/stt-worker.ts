/**
 * Dedicated worker: isolates Whisper ONNX/WASM from the main thread.
 */
/// <reference lib="webworker" />
import {
  ensureTransformersEnv,
  formatTransformersError,
  WHISPER_DTYPE,
  WHISPER_MODEL_PATH,
} from "../../agent/supervisor/transformers-env.js";
import { resampleTo16k, WHISPER_SAMPLE_RATE } from "./audio-decode.js";

const MODEL_ID = WHISPER_MODEL_PATH;

type Transcriber = (
  audio: Float32Array,
  options?: Record<string, unknown>
) => Promise<{ text: string }>;

let transcriberPromise: Promise<Transcriber> | null = null;
let queue: Promise<void> = Promise.resolve();

function resetTranscriber(): void {
  transcriberPromise = null;
}

async function clearWhisperTransformersCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    for (const req of keys) {
      if (req.url.includes("whisper-tiny-en")) await cache.delete(req);
    }
  } catch {
    /* cache unavailable */
  }
}

async function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      await ensureTransformersEnv();
      await clearWhisperTransformersCache();
      const { pipeline } = await import("@huggingface/transformers");
      const pipe = await pipeline("automatic-speech-recognition", MODEL_ID, {
        device: "wasm",
        dtype: WHISPER_DTYPE,
      });
      return pipe as unknown as Transcriber;
    })().catch((err) => {
      resetTranscriber();
      throw err;
    });
  }
  return transcriberPromise;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function transcribeSamples(samples: Float32Array, sampleRate: number): Promise<string> {
  const audio =
    sampleRate === WHISPER_SAMPLE_RATE ? samples : resampleTo16k(samples, sampleRate);
  const transcriber = await getTranscriber();
  const out = await transcriber(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return String(out?.text ?? "").trim();
}

type WorkerIn =
  | { type: "init" }
  | { type: "transcribe"; requestId: string; samples: Float32Array; sampleRate: number };

type WorkerOut =
  | { type: "ready" }
  | { type: "result"; requestId: string; text: string }
  | { type: "error"; requestId?: string; error: string };

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  void (async () => {
    try {
      if (msg.type === "init") {
        await getTranscriber();
        (self as DedicatedWorkerGlobalScope).postMessage({ type: "ready" } satisfies WorkerOut);
        return;
      }
      if (msg.type === "transcribe") {
        const text = await enqueue(() => transcribeSamples(msg.samples, msg.sampleRate));
        (self as DedicatedWorkerGlobalScope).postMessage({
          type: "result",
          requestId: msg.requestId,
          text,
        } satisfies WorkerOut);
        return;
      }
    } catch (err) {
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "error",
        requestId: msg.type === "transcribe" ? msg.requestId : undefined,
        error: formatTransformersError(err),
      } satisfies WorkerOut);
    }
  })();
};
