import { isSubscriptionProvider } from "./constants.mjs";
import { normalizeProfileId } from "./auth-store.mjs";
import { resolveCodexSubscriptionCredential } from "./codex-auth.mjs";
import { resolveNousSubscriptionCredential } from "./nous-auth.mjs";
import { readRequestBody, requestUrlPath, setSubscriptionLlmCors } from "./http-utils.mjs";
import { handleSubscriptionOAuthApi } from "./oauth-handler.mjs";
import { passthroughSubscriptionProxy, proxyCodexChatCompletions } from "./llm-proxy.mjs";

/** @type {{ debug?: Function, error?: Function } | null} */
let logger = null;

export function setSubscriptionProxyLogger(next) {
  logger = next || null;
}

export function parseSubscriptionLlmTarget(url) {
  const parsed = new URL(url, "http://localhost");
  const prefix = "/api/llm/";
  if (!parsed.pathname.startsWith(prefix)) return null;
  const suffix = parsed.pathname.slice(prefix.length);
  const [provider, ...segments] = suffix.split("/").filter(Boolean);
  if (!provider || !isSubscriptionProvider(provider) || segments.length === 0) return null;
  return { provider, targetPath: `/${segments.join("/")}${parsed.search}` };
}

export function isSubscriptionLlmPath(url) {
  const pathname = requestUrlPath({ url });
  return pathname.startsWith("/api/llm/nous/") || pathname.startsWith("/api/llm/openai-codex/");
}

export function isSubscriptionOAuthPath(url) {
  return requestUrlPath({ url }).startsWith("/api/providers/oauth/");
}

export async function handleSubscriptionLlmProxy(req, res) {
  const url = String(req.url || "");
  const parsed = parseSubscriptionLlmTarget(url);
  if (!parsed) return false;

  const routeId = `llm:${parsed.provider}`;
  const profileId = normalizeProfileId(req.headers["x-webagent-profile-id"]);

  try {
    const body = await readRequestBody(req);
    if (parsed.provider === "openai-codex") {
      const credential = await resolveCodexSubscriptionCredential(profileId);
      if (parsed.targetPath.startsWith("/chat/completions")) {
        await proxyCodexChatCompletions(req, res, credential.apiKey, credential.baseUrl, body || Buffer.from("{}"));
        logger?.debug?.(req, routeId, res.statusCode);
        return true;
      }
      await passthroughSubscriptionProxy(
        req,
        res,
        `${credential.baseUrl}${parsed.targetPath}`,
        credential.apiKey,
        body
      );
      logger?.debug?.(req, routeId, res.statusCode);
      return true;
    }
    if (parsed.provider === "nous") {
      const credential = await resolveNousSubscriptionCredential(profileId);
      await passthroughSubscriptionProxy(
        req,
        res,
        `${credential.baseUrl}${parsed.targetPath}`,
        credential.apiKey,
        body
      );
      logger?.debug?.(req, routeId, res.statusCode);
      return true;
    }
    return false;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    res.statusCode = /not configured|re-authenticate|refresh token|access token/i.test(msg) ? 401 : 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: msg }));
    logger?.error?.(req, routeId, error);
    return true;
  }
}

export async function handleSubscriptionHttp(req, res) {
  if (isSubscriptionOAuthPath(req.url)) {
    return handleSubscriptionOAuthApi(req, res);
  }
  if (isSubscriptionLlmPath(req.url)) {
    setSubscriptionLlmCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }
    return handleSubscriptionLlmProxy(req, res);
  }
  return false;
}
