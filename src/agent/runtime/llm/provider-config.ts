import fs from "node:fs/promises";
import type { ProviderDefinition } from "../../../core/providers/index.js";
import { PROVIDER_CATALOG_PATH } from "../constants.js";
import { fetchContextWindow } from "./model-metadata.js";
import { isBigPickleModel } from "./model-quirks.js";

export { fetchContextWindow };

let providerCatalogCache: ProviderDefinition[] | null = null;

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
  const useLocalProxy = selectedProvider.runtime?.useLocalProxy !== false;
  if (runtimeKind === "nodebox" && appOrigin && proxyProviderId && useLocalProxy) {
    return `${appOrigin.replace(/\/$/, "")}${LLM_PROXY_PATH_PREFIX}/${proxyProviderId}`;
  }

  return trimmedDirect;
}

/** When true, provider reasoning streams may be surfaced as ephemeral UI preview. */
export function reasoningPreviewEnabled() {
  return String(process.env.WEBAGENT_REASONING_PREVIEW ?? "1").trim() !== "0";
}

/** Disable provider-native thinking/reasoning on chat/completions requests. */
export function reasoningDisableExtras(providerId, modelId) {
  const id = String(providerId || "").trim().toLowerCase();
  const model = String(modelId || "").trim();
  if (isBigPickleModel({ provider: id, model })) {
    return { reasoning: { enabled: false } };
  }
  if (reasoningPreviewEnabled()) return {};
  if (id === "openrouter") return { reasoning: { enabled: false } };
  if (id === "opencode") return { reasoning: { enabled: false } };
  return {};
}

/** Provider-specific chat/completions body fields (stream usage, etc.). */
export function llmChatCompletionExtras(providerId, { stream = false, model } = {}) {
  const id = String(providerId || "").trim().toLowerCase();
  const extras = { ...reasoningDisableExtras(id, model) };
  if (stream && id !== "nous" && id !== "openai-codex") {
    extras.stream_options = { include_usage: true };
  }
  return extras;
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
  const apiKey = apiKeyEnvVar
    ? String(process.env[apiKeyEnvVar] || "").trim()
    : String(selectedProvider.runtime?.builtinApiKey || "").trim();
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
    model:
      selectedProvider.id === "opencode"
        ? selectedProvider.model || "big-pickle"
        : modelOverride || selectedProvider.model || "",
    extraHeaders: {
      ...(selectedProvider.runtime?.extraHeaders || {}),
      ...envExtraHeaders,
    },
  };
}

