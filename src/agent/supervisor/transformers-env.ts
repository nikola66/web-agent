const ORT_PUBLIC_PREFIX = "transformers-ort/";
const LOOP_GUARD_MODEL_SUFFIX = "models/loop-guard";
const WHISPER_MODEL_SUFFIX = "models/whisper-tiny-en";
/** Smallest Xenova quant variant — lower WASM peak than model_quantized (q8). */
export const LOOP_GUARD_DTYPE = "q4f16" as const;
export const WHISPER_DTYPE = "q4f16" as const;

let configured = false;

function viteBaseUrl(): string {
  if (typeof import.meta === "undefined") return "/";
  const base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  return typeof base === "string" && base ? base : "/";
}

function publicAssetPath(suffix: string): string {
  const base = viteBaseUrl().replace(/\/?$/, "/");
  const path = `${base}${suffix.replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
  return path.startsWith("/") ? path : `/${path}`;
}

export const LOOP_GUARD_MODEL_PATH = publicAssetPath(LOOP_GUARD_MODEL_SUFFIX);
export const WHISPER_MODEL_PATH = publicAssetPath(WHISPER_MODEL_SUFFIX);

function runtimeOrigin(): string | null {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  if (typeof self !== "undefined" && "location" in self) {
    const origin = (self as WorkerGlobalScope & { location?: { origin?: string } }).location?.origin;
    if (origin) return origin;
  }
  return null;
}

function ortAssetBase(): string {
  const path = publicAssetPath(ORT_PUBLIC_PREFIX);
  const origin = runtimeOrigin();
  if (!origin) return path.endsWith("/") ? path : `${path}/`;
  return new URL(path.endsWith("/") ? path : `${path}/`, origin).href;
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
