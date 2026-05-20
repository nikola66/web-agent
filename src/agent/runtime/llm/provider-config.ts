import fs from "node:fs/promises";
import type { ProviderDefinition } from "../../../core/providers/index.js";
import {
  LLM_METADATA_TIMEOUT_MS,
  MODEL_CONTEXT_WINDOWS,
  OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW,
  PROVIDER_CATALOG_PATH,
} from "../constants.js";

let providerCatalogCache: ProviderDefinition[] | null = null;

function sanitizeHeadersForFetch(headers = {}) {
  const out = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "");
    out[name] = value.replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}

async function loadProviderCatalog(): Promise<ProviderDefinition[]> {
  if (providerCatalogCache) return providerCatalogCache;
  try {
    const raw = await fs.readFile(PROVIDER_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      providerCatalogCache = parsed.filter(
        (provider) =>
          provider &&
          typeof provider === "object" &&
          typeof provider.id === "string" &&
          typeof provider.kind === "string"
      );
      return providerCatalogCache;
    }
  } catch {
    /* fall through */
  }
  providerCatalogCache = [];
  return providerCatalogCache;
}

const LLM_PROXY_PATH_PREFIX = "/api/llm";

function normalizeBaseUrl(baseUrl, ensureV1Suffix) {
  const trimmed = String(baseUrl || "").replace(/\/$/, "");
  if (!trimmed) return "";
  if (!ensureV1Suffix) return trimmed;
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function resolveBuiltInBaseUrl(selectedProvider, customBaseUrl, directBaseUrl) {
  if (customBaseUrl) {
    return normalizeBaseUrl(customBaseUrl, Boolean(selectedProvider.runtime?.ensureV1Suffix));
  }

  const trimmedDirect = String(directBaseUrl || "").trim();
  if (!trimmedDirect) return "";

  const runtimeKind = String(process.env.WEBAGENT_RUNTIME || "").trim();
  const appOrigin = String(process.env.WEBAGENT_APP_ORIGIN || "").trim();
  const proxyProviderId = String(
    selectedProvider.runtime?.basePath || selectedProvider.id || ""
  ).trim();
  if (runtimeKind === "nodebox" && appOrigin && proxyProviderId) {
    return `${appOrigin.replace(/\/$/, "")}${LLM_PROXY_PATH_PREFIX}/${proxyProviderId}`;
  }

  return trimmedDirect;
}

/** Disable provider-native thinking/reasoning on chat/completions requests. */
export function reasoningDisableExtras(providerId) {
  const id = String(providerId || "").trim().toLowerCase();
  if (id === "openrouter") return { reasoning: { enabled: false } };
  return { reasoning_effort: "none" };
}

export async function resolveLlm() {
  const catalog = await loadProviderCatalog();
  const forced = (process.env.WEBAGENT_PROVIDER || "auto").toLowerCase();
  const modelOverride = (process.env.WEBAGENT_MODEL || "").trim();

  const selectedProvider =
    catalog.find((provider) => provider.id === forced) ||
    catalog.find((provider) => provider.isDefault) ||
    catalog[0];
  if (!selectedProvider) return null;

  const apiKeyEnvVar = selectedProvider.apiKey?.envVar;
  const apiKey = apiKeyEnvVar ? String(process.env[apiKeyEnvVar] || "").trim() : "";
  if (selectedProvider.requiresUserApiKey && !apiKey) return null;

  const customBaseUrlEnvVar = selectedProvider.runtime?.customBaseUrlEnvVar;
  const customBaseUrl = customBaseUrlEnvVar
    ? String(process.env[customBaseUrlEnvVar] || "").trim()
    : "";
  const directBaseUrl = selectedProvider.runtime?.fallbackBaseUrl || "";
  const baseUrl = resolveBuiltInBaseUrl(selectedProvider, customBaseUrl, directBaseUrl);
  if (!baseUrl) return null;

  const envExtraHeaders = {};
  const httpReferer = String(process.env.WEBAGENT_HTTP_REFERER || "").trim();
  const openRouterTitle = String(process.env.WEBAGENT_OPENROUTER_TITLE || "").trim();
  if (httpReferer) envExtraHeaders["HTTP-Referer"] = httpReferer;
  if (openRouterTitle) envExtraHeaders["X-OpenRouter-Title"] = openRouterTitle;

  return {
    provider: selectedProvider.id,
    kind: "openai",
    baseUrl,
    apiKey,
    model: modelOverride || selectedProvider.model || "",
    extraHeaders: {
      ...(selectedProvider.runtime?.extraHeaders || {}),
      ...envExtraHeaders,
    },
  };
}

export function getKnownContextWindow(model) {
  const m = String(model || "").trim();
  if (!m) return null;
  const exact = MODEL_CONTEXT_WINDOWS[m];
  if (typeof exact === "number") return exact;
  const key = Object.keys(MODEL_CONTEXT_WINDOWS).find((name) => m.startsWith(name));
  return key ? MODEL_CONTEXT_WINDOWS[key] : null;
}

export async function fetchContextWindow(cfg, fetchWithTimeout) {
  if (!cfg?.model) return null;
  const known = getKnownContextWindow(cfg.model);
  if (known) return known;
  const isOpenRouterFreeModel =
    cfg.model === "openrouter/free";
  if (cfg.provider === "openrouter") {
    try {
      const res = await fetchWithTimeout(
        `${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}`,
        {
          headers: sanitizeHeadersForFetch({
            Authorization: `Bearer ${cfg.apiKey}`,
            ...cfg.extraHeaders,
          }),
        },
        LLM_METADATA_TIMEOUT_MS,
        "OpenRouter model metadata request"
      );
      if (res.ok) {
        const payload = await res.json();
        const value = payload?.data?.context_length ?? payload?.context_length;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          return Math.round(value);
        }
      }
    } catch {
      /* non-fatal */
    }
  }
  if (isOpenRouterFreeModel) return OPENROUTER_FREE_DEFAULT_CONTEXT_WINDOW;
  return null;
}
