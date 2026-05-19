const ORT_PUBLIC_PREFIX = "/transformers-ort/";
export const LOOP_GUARD_MODEL_PATH = "/models/loop-guard";

let configured = false;

function ortAssetBase(): string {
  if (typeof window === "undefined") return ORT_PUBLIC_PREFIX;
  return new URL(ORT_PUBLIC_PREFIX, window.location.origin).href;
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
  wasm.numThreads =
    typeof globalThis.crossOriginIsolated === "boolean" && globalThis.crossOriginIsolated ? 0 : 1;
  wasm.proxy = false;
  (env.backends.onnx as { wasm?: Record<string, unknown> }).wasm = wasm;
}
