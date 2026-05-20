import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Set immediately before a deploy-stale-chunk reload; cleared once the app loads successfully. */
export const CHUNK_RELOAD_SESSION_KEY = "webagent-chunk-reload";

const CHUNK_LOAD_ERROR_RE =
  /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|chunkloaderror/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return CHUNK_LOAD_ERROR_RE.test(error.message);
}

export function hasChunkReloadFlag(): boolean {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearChunkReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}

export function reloadAppForStaleChunks(): void {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, "1");
  } catch {
    /* still reload */
  }
  window.location.reload();
}

export function registerStaleChunkRecovery(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    if (!hasChunkReloadFlag()) reloadAppForStaleChunks();
  });

  const onLoaded = () => clearChunkReloadFlag();
  if (document.readyState === "complete") onLoaded();
  else window.addEventListener("load", onLoaded, { once: true });
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await importer();
      clearChunkReloadFlag();
      return mod;
    } catch (error) {
      if (!isChunkLoadError(error)) throw error;
      if (!hasChunkReloadFlag()) {
        reloadAppForStaleChunks();
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
