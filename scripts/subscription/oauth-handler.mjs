import { randomUUID } from "node:crypto";
import {
  DEFAULT_NOUS_INFERENCE_URL,
  DEFAULT_NOUS_PORTAL_URL,
  isSubscriptionProvider,
  OAUTH_SESSION_TTL_SECONDS,
} from "./constants.mjs";
import { deleteSubscriptionProfileState, envValue, normalizeProfileId } from "./auth-store.mjs";
import {
  buildCodexDeviceVerificationUrl,
  exchangeCodexDeviceCode,
  getCodexAuthStatus,
  parseCodexPollInterval,
  persistCodexDeviceTokens,
  pollCodexDeviceAuth,
  requestCodexDeviceCode,
} from "./codex-auth.mjs";
import {
  getNousAuthStatus,
  persistNousDeviceToken,
  pollNousDeviceToken,
  requestNousDeviceCodeWithScopeFallback,
} from "./nous-auth.mjs";
import { readRequestJson, requestUrlPath, sendJson, setSubscriptionOAuthCors } from "./http-utils.mjs";

/** @type {Map<string, import('./oauth-handler.mjs').OAuthSession>} */
const oauthSessions = new Map();

function gcOAuthSessions() {
  const cutoff = Date.now() - OAUTH_SESSION_TTL_SECONDS * 1000;
  for (const [id, session] of oauthSessions.entries()) {
    if (session.createdAt < cutoff || session.expiresAt < Date.now()) {
      oauthSessions.delete(id);
    }
  }
}

function getSubscriptionAuthStatus(provider, profileId) {
  if (provider === "nous") return getNousAuthStatus(profileId);
  if (provider === "openai-codex") return getCodexAuthStatus(profileId);
  return { logged_in: false };
}

export async function handleSubscriptionOAuthApi(req, res) {
  const pathname = requestUrlPath(req);
  const providerMatch = pathname.match(/^\/api\/providers\/oauth\/([^/]+)/);
  const provider = providerMatch?.[1] || "";
  if (!isSubscriptionProvider(provider)) return false;

  setSubscriptionOAuthCors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (pathname === `/api/providers/oauth/${provider}/status` && req.method === "GET") {
      const profileId = normalizeProfileId(new URL(req.url || "", "http://localhost").searchParams.get("profile_id"));
      if (!profileId) {
        sendJson(res, 400, { error: "profile_id_required" });
        return true;
      }
      sendJson(res, 200, getSubscriptionAuthStatus(provider, profileId));
      return true;
    }

    if (pathname === `/api/providers/oauth/${provider}/logout` && (req.method === "POST" || req.method === "DELETE")) {
      const payload = await readRequestJson(req);
      const profileId = normalizeProfileId(payload.profile_id);
      if (!profileId) {
        sendJson(res, 400, { error: "profile_id_required" });
        return true;
      }
      deleteSubscriptionProfileState(provider, profileId);
      sendJson(res, 200, { ok: true, logged_in: false });
      return true;
    }

    if (provider === "nous" && pathname === "/api/providers/oauth/nous/start" && req.method === "POST") {
      gcOAuthSessions();
      const payload = await readRequestJson(req);
      const profileId = normalizeProfileId(payload.profile_id);
      if (!profileId) {
        sendJson(res, 400, { error: "profile_id_required" });
        return true;
      }
      const portalBaseUrl = String(
        envValue("HERMES_PORTAL_BASE_URL") || envValue("NOUS_PORTAL_BASE_URL") || DEFAULT_NOUS_PORTAL_URL
      ).replace(/\/$/, "");
      const inferenceBaseUrl = String(envValue("NOUS_INFERENCE_BASE_URL") || DEFAULT_NOUS_INFERENCE_URL).replace(/\/$/, "");
      const clientId = "hermes-cli";
      const { deviceData, scope } = await requestNousDeviceCodeWithScopeFallback(portalBaseUrl, clientId);
      const sessionId = randomUUID();
      const expiresIn = Number(deviceData.expires_in || 900);
      const interval = Number(deviceData.interval || 2);
      oauthSessions.set(sessionId, {
        createdAt: Date.now(),
        profileId,
        provider: "nous",
        flow: "nous_device",
        deviceCode: String(deviceData.device_code || ""),
        expiresAt: Date.now() + expiresIn * 1000,
        interval,
        portalBaseUrl,
        inferenceBaseUrl,
        clientId,
        scope,
        status: "pending",
      });
      sendJson(res, 200, {
        session_id: sessionId,
        flow: "device_code",
        user_code: String(deviceData.user_code || ""),
        verification_url: String(deviceData.verification_uri_complete || deviceData.verification_uri || ""),
        expires_in: expiresIn,
        poll_interval: interval,
      });
      return true;
    }

    if (provider === "openai-codex" && pathname === "/api/providers/oauth/openai-codex/start" && req.method === "POST") {
      gcOAuthSessions();
      const payload = await readRequestJson(req);
      const profileId = normalizeProfileId(payload.profile_id);
      if (!profileId) {
        sendJson(res, 400, { error: "profile_id_required" });
        return true;
      }
      const deviceData = await requestCodexDeviceCode();
      const sessionId = randomUUID();
      const userCode = String(deviceData.user_code || "");
      const deviceAuthId = String(deviceData.device_auth_id || "");
      const interval = parseCodexPollInterval(deviceData.interval);
      oauthSessions.set(sessionId, {
        createdAt: Date.now(),
        profileId,
        provider: "openai-codex",
        flow: "codex_device",
        deviceAuthId,
        userCode,
        expiresAt: Date.now() + OAUTH_SESSION_TTL_SECONDS * 1000,
        interval,
        status: "pending",
      });
      sendJson(res, 200, {
        session_id: sessionId,
        flow: "device_code",
        user_code: userCode,
        verification_url: buildCodexDeviceVerificationUrl(userCode, deviceAuthId),
        poll_interval: interval,
      });
      return true;
    }

    const pollMatch = pathname.match(/^\/api\/providers\/oauth\/([^/]+)\/poll\/([^/]+)$/);
    if (pollMatch && req.method === "GET") {
      const pollProvider = pollMatch[1];
      const sessionId = pollMatch[2];
      const session = oauthSessions.get(sessionId);
      if (!session || session.provider !== pollProvider) {
        sendJson(res, 404, { status: "expired", message: "Unknown or expired OAuth session" });
        return true;
      }
      if (session.status !== "pending") {
        sendJson(res, 200, { status: session.status, message: session.error || null });
        return true;
      }
      if (session.expiresAt < Date.now()) {
        session.status = "expired";
        sendJson(res, 200, { status: "expired", message: "OAuth session expired" });
        return true;
      }

      if (pollProvider === "nous") {
        const result = await pollNousDeviceToken(session.portalBaseUrl, session.clientId, session.deviceCode);
        if (result.status === "pending") {
          sendJson(res, 200, { status: "pending", retry_after: result.retryAfterSeconds || session.interval });
          return true;
        }
        await persistNousDeviceToken(session, result.payload || {});
        session.status = "approved";
        sendJson(res, 200, { status: "approved" });
        return true;
      }

      if (pollProvider === "openai-codex") {
        const result = await pollCodexDeviceAuth(String(session.deviceAuthId || ""), String(session.userCode || ""));
        if (result.status === "pending") {
          sendJson(res, 200, { status: "pending", retry_after: session.interval || 5 });
          return true;
        }
        const tokens = await exchangeCodexDeviceCode(result.payload || {});
        persistCodexDeviceTokens(session.profileId, tokens);
        session.status = "approved";
        sendJson(res, 200, { status: "approved" });
        return true;
      }
    }

    sendJson(res, 404, { error: "not_found" });
    return true;
  } catch (error) {
    sendJson(res, 500, { status: "error", error: error instanceof Error ? error.message : String(error) });
    return true;
  }
}
