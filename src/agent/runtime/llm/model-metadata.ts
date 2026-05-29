import {
  LLM_METADATA_TIMEOUT_MS,
  OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW,
} from "../constants.js";
import { ipcProxyRequest } from "../ipc.js";
import { sanitizeHeadersForFetch, shouldUseNodeboxLlmProxy } from "./http-utils.js";

const catalogCache = new Map<string, Map<string, number>>();

function authHeaders(cfg) {
  const headers = { ...cfg.extraHeaders };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  return sanitizeHeadersForFetch(headers);
}

function parseContextLengthFromEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const topProvider =
    entry.top_provider && typeof entry.top_provider === "object" ? entry.top_provider : null;
  const candidates = [
    entry.context_length,
    entry.context_window,
    entry.max_context_length,
    topProvider?.context_length,
  ];
  for (const value of candidates) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function indexModelEntry(map, entry) {
  const contextLength = parseContextLengthFromEntry(entry);
  if (contextLength == null) return;
  for (const rawId of [entry.id, entry.canonical_slug]) {
    const id = String(rawId || "").trim();
    if (id) map.set(id, contextLength);
  }
}

export function parseModelsCatalog(payload) {
  const map = new Map<string, number>();
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : [];
  for (const entry of list) indexModelEntry(map, entry);
  return map;
}

function catalogCacheKey(cfg) {
  return `${cfg.provider}:${cfg.baseUrl}`;
}

async function metadataHttpFetch(url, options, fetchWithTimeout, timeoutMs, label) {
  if (shouldUseNodeboxLlmProxy(url)) {
    const raw = await ipcProxyRequest(
      {
        method: options.method || "GET",
        url,
        headers: options.headers,
        body: options.body ?? null,
      },
      timeoutMs
    );
    if (raw?.error) throw new Error(String(raw.error));
    const status = Number(raw.status ?? 0);
    const bodyText = String(raw.body ?? "");
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!bodyText) return {};
        return JSON.parse(bodyText);
      },
    };
  }
  return fetchWithTimeout(url, options, timeoutMs, label);
}

async function fetchModelsCatalog(cfg, fetchWithTimeout) {
  const key = catalogCacheKey(cfg);
  const cached = catalogCache.get(key);
  if (cached) return cached;

  let map = new Map<string, number>();
  try {
    const res = await metadataHttpFetch(
      `${cfg.baseUrl}/models`,
      { headers: authHeaders(cfg) },
      fetchWithTimeout,
      LLM_METADATA_TIMEOUT_MS,
      "LLM models catalog request"
    );
    if (res.ok) {
      map = parseModelsCatalog(await res.json());
      catalogCache.set(key, map);
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

function ollamaNativeBase(baseUrl) {
  try {
    const url = new URL(String(baseUrl || ""));
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return "";
  }
}

async function fetchOllamaShowContext(cfg, model, fetchWithTimeout) {
  const nativeBase = ollamaNativeBase(cfg.baseUrl);
  if (!nativeBase) return null;
  try {
    const res = await metadataHttpFetch(
      `${nativeBase}/api/show`,
      {
        method: "POST",
        headers: {
          ...authHeaders(cfg),
          "content-type": "application/json",
        },
        body: JSON.stringify({ model }),
      },
      fetchWithTimeout,
      LLM_METADATA_TIMEOUT_MS,
      "Ollama model show request"
    );
    if (!res.ok) return null;
    const payload = await res.json();
    const modelInfo = payload?.model_info;
    if (!modelInfo || typeof modelInfo !== "object") return null;
    for (const [key, value] of Object.entries(modelInfo)) {
      const n = typeof value === "number" ? value : Number(value);
      if (key.endsWith(".context_length") && Number.isFinite(n) && n > 0) {
        return Math.round(n);
      }
    }
  } catch {
    /* non-fatal */
  }
  return null;
}

export async function fetchContextWindow(cfg, fetchWithTimeout) {
  if (!cfg?.model) return null;
  const model = String(cfg.model).trim();
  if (!model) return null;
  if (model === "openrouter/free") return OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW;
  if (cfg.provider === "opencode" && model === "big-pickle") return 200_000;
  if (cfg.provider === "bitnet") return 2048;

  const catalog = await fetchModelsCatalog(cfg, fetchWithTimeout);
  const fromCatalog = catalog.get(model);
  if (fromCatalog != null) return fromCatalog;

  if (cfg.provider === "ollama") {
    return fetchOllamaShowContext(cfg, model, fetchWithTimeout);
  }
  return null;
}

export function resetModelMetadataCacheForTests() {
  catalogCache.clear();
}
