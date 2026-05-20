const ORT_PUBLIC_PREFIX = "/transformers-ort/";
export const LOOP_GUARD_MODEL_PATH = "/models/loop-guard";

let configured = false;

function runtimeOrigin(): string | null {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  if (typeof self !== "undefined" && "location" in self) {
    const origin = (self as WorkerGlobalScope & { location?: { origin?: string } }).location?.origin;
    if (origin) return origin;
  }
  return null;
}

function ortAssetBase(): string {
  const origin = runtimeOrigin();
  if (!origin) return ORT_PUBLIC_PREFIX;
  return new URL(ORT_PUBLIC_PREFIX, origin).href;
}

export function formatTransformersError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    const message = String((error as { message?: unknown }).message ?? "");
    if (message) return message;
  }
  const raw = String(error ?? "unknown");
  if (/^\d{5,}$/.test(raw)) {
    return `ONNX Runtime Web error ${raw} (check /transformers-ort/ WASM and ${LOOP_GUARD_MODEL_PATH}/ weights)`;
  }
  return raw;
}

/** Must run before the first Transformers.js pipeline call in the browser. */
export async function ensureTransformersEnv(): Promise<void> {
  if (configured) return;
  configured = true;

  const { env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.useBrowserCache = true;
  const wasm = (env.backends.onnx as { wasm?: Record<string, unknown> }).wasm ?? {};
  wasm.wasmPaths = ortAssetBase();
  wasm.numThreads = 1;
  wasm.proxy = false;
  (env.backends.onnx as { wasm?: Record<string, unknown> }).wasm = wasm;
}
