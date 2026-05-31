const SUBSCRIPTION_LLM_PROVIDER_IDS = ["nous", "openai-codex"] as const;

export function isSubscriptionLlmEndpoint(endpoint: string): boolean {
  const target = String(endpoint || "");
  return SUBSCRIPTION_LLM_PROVIDER_IDS.some((id) => target.includes(`/api/llm/${id}/`));
}

export function withRuntimeSubscriptionProfileHeader(
  endpoint: string,
  headers: Record<string, string> = {}
): Record<string, string> {
  if (!isSubscriptionLlmEndpoint(endpoint)) return headers;
  const profileId = String(process.env.WEBAGENT_PROFILE_ID || "").trim();
  if (!profileId) return headers;
  return { ...headers, "x-webagent-profile-id": profileId };
}

export function shouldUseNodeboxLlmProxy(endpoint: string): boolean {
  const runtime = String(process.env.WEBAGENT_RUNTIME || "").trim();
  if (runtime !== "nodebox" && runtime !== "linuxontab") return false;
  const appOrigin = String(process.env.WEBAGENT_APP_ORIGIN || "").trim().replace(/\/$/, "");
  return !!(appOrigin && String(endpoint || "").startsWith(`${appOrigin}/api/llm/`));
}

export function sanitizeHeadersForFetch(headers: Record<string, unknown> = {}) {
  const out: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    const value = String(rawValue ?? "");
    out[name] = value.replace(/[^\x00-\xFF]/g, "");
  }
  return out;
}
