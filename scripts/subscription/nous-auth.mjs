import {
  ACCESS_TOKEN_REFRESH_SKEW_SECONDS,
  DEFAULT_AGENT_KEY_MIN_TTL_SECONDS,
  DEFAULT_NOUS_INFERENCE_URL,
  DEFAULT_NOUS_PORTAL_URL,
  DEFAULT_NOUS_SCOPE,
  NOUS_INFERENCE_INVOKE_SCOPE,
  NOUS_INVOKE_JWT_MIN_TTL_SECONDS,
  NOUS_LEGACY_AGENT_KEY_SCOPE,
} from "./constants.mjs";
import {
  envValue,
  getSubscriptionProfileState,
  isExpiring,
  jwtExpiresAtIso,
  parseIsoTimestamp,
  setSubscriptionProfileState,
  tokenHasScope,
} from "./auth-store.mjs";

function isNousInvokeJwtUsable(accessToken, scope, expiresAt, minTtlSeconds = NOUS_INVOKE_JWT_MIN_TTL_SECONDS) {
  if (typeof accessToken !== "string" || accessToken.split(".").length !== 3) return false;
  if (!tokenHasScope(accessToken, NOUS_INFERENCE_INVOKE_SCOPE)) return false;
  return !isExpiring(jwtExpiresAtIso(accessToken, expiresAt), minTtlSeconds);
}

async function refreshNousAccessToken(portalBaseUrl, clientId, refreshToken) {
  const response = await fetch(`${portalBaseUrl}/api/oauth/token`, {
    method: "POST",
    headers: {
      "x-nous-refresh-token": refreshToken,
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token.trim()) {
    throw new Error(String(payload?.error_description || payload?.error || "Nous Portal token refresh failed"));
  }
  return payload;
}

async function mintNousAgentKey(portalBaseUrl, accessToken, minTtlSeconds) {
  const response = await fetch(`${portalBaseUrl}/api/oauth/agent-key`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ min_ttl_seconds: Math.max(60, minTtlSeconds) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.api_key !== "string" || !payload.api_key.trim()) {
    throw new Error(String(payload?.error_description || payload?.error || "Nous Portal agent-key mint failed"));
  }
  return payload;
}

async function requestNousDeviceCode(portalBaseUrl, clientId, scope) {
  const response = await fetch(`${portalBaseUrl}/api/oauth/device/code`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ client_id: clientId, scope }),
  });
  const payload = await response.json().catch(() => ({}));
  const missing = [
    "device_code",
    "user_code",
    "verification_uri",
    "verification_uri_complete",
    "expires_in",
    "interval",
  ].filter((field) => payload?.[field] == null);
  if (!response.ok || missing.length > 0) {
    throw new Error(String(payload?.error_description || payload?.error || "Nous device-code request failed"));
  }
  return payload;
}

export async function requestNousDeviceCodeWithScopeFallback(portalBaseUrl, clientId) {
  try {
    return { deviceData: await requestNousDeviceCode(portalBaseUrl, clientId, DEFAULT_NOUS_SCOPE), scope: DEFAULT_NOUS_SCOPE };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.includes("scope")) throw error;
    return {
      deviceData: await requestNousDeviceCode(portalBaseUrl, clientId, NOUS_LEGACY_AGENT_KEY_SCOPE),
      scope: NOUS_LEGACY_AGENT_KEY_SCOPE,
    };
  }
}

export async function pollNousDeviceToken(portalBaseUrl, clientId, deviceCode) {
  const response = await fetch(`${portalBaseUrl}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && typeof payload?.access_token === "string" && payload.access_token.trim()) {
    return { status: "approved", payload };
  }
  const code = String(payload?.error || "");
  if (code === "authorization_pending" || code === "slow_down") {
    return { status: "pending", retryAfterSeconds: code === "slow_down" ? 5 : undefined };
  }
  throw new Error(String(payload?.error_description || payload?.error || "Nous device authorization failed"));
}

export async function persistNousDeviceToken(session, tokenData) {
  const profileId = String(session.profileId || "").trim();
  if (!profileId) throw new Error("Missing profile_id for Nous OAuth session");
  const now = new Date();
  const expiresIn = Number(tokenData.expires_in || 0);
  const accessToken = String(tokenData.access_token || "").trim();
  const state = {
    portal_base_url: session.portalBaseUrl,
    inference_base_url: String(tokenData.inference_base_url || session.inferenceBaseUrl).replace(/\/$/, ""),
    client_id: session.clientId,
    scope: tokenData.scope || session.scope,
    token_type: tokenData.token_type || "Bearer",
    access_token: accessToken,
    refresh_token: tokenData.refresh_token || null,
    obtained_at: now.toISOString(),
    expires_at: expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000).toISOString() : null,
    expires_in: expiresIn,
    tls: { insecure: false, ca_bundle: null },
    agent_key: null,
    agent_key_id: null,
    agent_key_expires_at: null,
    agent_key_expires_in: null,
    agent_key_reused: null,
    agent_key_obtained_at: null,
  };

  if (isNousInvokeJwtUsable(accessToken, state.scope, state.expires_at)) {
    const agentKeyExpiresAt = jwtExpiresAtIso(accessToken, state.expires_at);
    state.agent_key = accessToken;
    state.agent_key_id = null;
    state.agent_key_expires_at = agentKeyExpiresAt;
    state.agent_key_expires_in = Math.max(
      0,
      Math.floor(((parseIsoTimestamp(agentKeyExpiresAt) ?? Date.now()) - Date.now()) / 1000)
    );
    state.agent_key_reused = false;
    state.agent_key_obtained_at = now.toISOString();
  } else {
    const minted = await mintNousAgentKey(session.portalBaseUrl, accessToken, 5 * 60);
    state.agent_key = minted.api_key;
    state.agent_key_id = minted.key_id || null;
    state.agent_key_expires_at = minted.expires_at || null;
    state.agent_key_expires_in = minted.expires_in || null;
    state.agent_key_reused = Boolean(minted.reused);
    state.agent_key_obtained_at = new Date().toISOString();
    if (minted.inference_base_url) {
      state.inference_base_url = String(minted.inference_base_url).replace(/\/$/, "");
    }
  }

  setSubscriptionProfileState("nous", profileId, state);
}

export function getNousAuthStatus(profileId) {
  const state = getSubscriptionProfileState("nous", profileId);
  return {
    logged_in: Boolean(state?.access_token),
    portal_base_url: state?.portal_base_url || null,
    inference_base_url: state?.inference_base_url || null,
    access_expires_at: state?.expires_at || null,
    agent_key_expires_at: state?.agent_key_expires_at || null,
    has_refresh_token: Boolean(state?.refresh_token),
  };
}

export async function resolveNousSubscriptionCredential(profileId) {
  const id = String(profileId || "").trim();
  if (!id) throw new Error("Nous subscription requires x-webagent-profile-id.");
  const state = getSubscriptionProfileState("nous", id);
  if (!state || typeof state !== "object") {
    throw new Error("Nous subscription is not configured for this agent. Connect it in Edit profile.");
  }

  const portalBaseUrl = String(
    state.portal_base_url || envValue("HERMES_PORTAL_BASE_URL") || envValue("NOUS_PORTAL_BASE_URL") || DEFAULT_NOUS_PORTAL_URL
  ).replace(/\/$/, "");
  const inferenceBaseUrl = String(
    state.inference_base_url || envValue("NOUS_INFERENCE_BASE_URL") || DEFAULT_NOUS_INFERENCE_URL
  ).replace(/\/$/, "");
  const clientId = String(state.client_id || "hermes-cli");
  let accessToken = String(state.access_token || "").trim();
  let refreshToken = String(state.refresh_token || "").trim();

  if (!accessToken) {
    throw new Error("Nous subscription is missing an access token. Re-authenticate in Edit profile.");
  }

  if (
    isExpiring(state.expires_at, ACCESS_TOKEN_REFRESH_SKEW_SECONDS) &&
    !isNousInvokeJwtUsable(accessToken, state.scope, state.expires_at)
  ) {
    if (!refreshToken) {
      throw new Error("Nous subscription has expired and no refresh token is available. Re-authenticate in Edit profile.");
    }
    const refreshed = await refreshNousAccessToken(portalBaseUrl, clientId, refreshToken);
    accessToken = String(refreshed.access_token || "").trim();
    refreshToken = String(refreshed.refresh_token || refreshToken).trim();
    const expiresIn = Number(refreshed.expires_in || 0);
    state.access_token = accessToken;
    state.refresh_token = refreshToken;
    state.token_type = refreshed.token_type || state.token_type || "Bearer";
    state.scope = refreshed.scope || state.scope;
    state.obtained_at = new Date().toISOString();
    if (Number.isFinite(expiresIn) && expiresIn > 0) {
      state.expires_in = expiresIn;
      state.expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
    } else {
      state.expires_in = null;
      state.expires_at = null;
    }
  }

  if (isNousInvokeJwtUsable(accessToken, state.scope, state.expires_at)) {
    state.agent_key = accessToken;
    state.agent_key_id = null;
    state.agent_key_expires_at = jwtExpiresAtIso(accessToken, state.expires_at);
    setSubscriptionProfileState("nous", id, state);
    return { baseUrl: inferenceBaseUrl, apiKey: accessToken };
  }

  const cachedAgentKey = String(state.agent_key || "").trim();
  if (cachedAgentKey && !isExpiring(state.agent_key_expires_at, DEFAULT_AGENT_KEY_MIN_TTL_SECONDS)) {
    return { baseUrl: inferenceBaseUrl, apiKey: cachedAgentKey };
  }

  const minted = await mintNousAgentKey(portalBaseUrl, accessToken, DEFAULT_AGENT_KEY_MIN_TTL_SECONDS);
  state.agent_key = minted.api_key;
  state.agent_key_id = minted.key_id || null;
  state.agent_key_expires_at = minted.expires_at || null;
  state.agent_key_expires_in = minted.expires_in || null;
  state.agent_key_reused = Boolean(minted.reused);
  state.agent_key_obtained_at = new Date().toISOString();
  setSubscriptionProfileState("nous", id, state);
  return { baseUrl: inferenceBaseUrl, apiKey: String(minted.api_key || "").trim() };
}
