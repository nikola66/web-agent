import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_ISSUER,
  CODEX_OAUTH_TOKEN_URL,
  DEFAULT_CODEX_BASE_URL,
} from "./constants.mjs";
import {
  decodeJwtClaims,
  getSubscriptionProfileState,
  jwtExpiresAtIso,
  setSubscriptionProfileState,
} from "./auth-store.mjs";

function getCodexTokens(state) {
  const tokens = state?.tokens;
  return tokens && typeof tokens === "object" && !Array.isArray(tokens) ? tokens : null;
}

function codexAccessTokenExpiring(accessToken, skewSeconds = 120) {
  const claims = decodeJwtClaims(accessToken);
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;
  return exp * 1000 <= Date.now() + skewSeconds * 1000;
}

async function refreshCodexAccessToken(refreshToken) {
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CODEX_OAUTH_CLIENT_ID,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || typeof payload?.access_token !== "string" || !payload.access_token.trim()) {
    throw new Error(String(payload?.error_description || payload?.error || "Codex token refresh failed"));
  }
  return {
    access_token: String(payload.access_token).trim(),
    refresh_token: String(payload.refresh_token || refreshToken).trim(),
    id_token: String(payload.id_token || "").trim(),
  };
}

export function parseCodexPollInterval(value) {
  const parsed = Number(String(value ?? "").trim() || 5);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(3, parsed) : 5;
}

export function buildCodexDeviceVerificationUrl(userCode, deviceAuthId) {
  const url = new URL(`${CODEX_OAUTH_ISSUER}/codex/device`);
  const code = String(userCode || "").trim();
  const authId = String(deviceAuthId || "").trim();
  if (code) url.searchParams.set("user_code", code);
  if (authId) url.searchParams.set("device_auth_id", authId);
  return url.toString();
}

export async function requestCodexDeviceCode() {
  const response = await fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error_description || payload?.error || "Codex device-code request failed"));
  }
  return payload;
}

export async function pollCodexDeviceAuth(deviceAuthId, userCode) {
  const response = await fetch(`${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  });
  if (response.status === 403 || response.status === 404) return { status: "pending" };
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error_description || payload?.error || "Codex device authorization failed"));
  }
  return { status: "approved", payload };
}

export async function exchangeCodexDeviceCode(payload) {
  const authorizationCode = String(payload.authorization_code || "");
  const codeVerifier = String(payload.code_verifier || "");
  if (!authorizationCode || !codeVerifier) {
    throw new Error("Codex device auth response missing authorization_code or code_verifier");
  }
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      redirect_uri: `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
      client_id: CODEX_OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || typeof json?.access_token !== "string") {
    throw new Error(String(json?.error_description || json?.error || "Codex token exchange failed"));
  }
  return {
    access_token: String(json.access_token).trim(),
    refresh_token: String(json.refresh_token || "").trim(),
    id_token: String(json.id_token || "").trim(),
  };
}

export function getCodexAuthStatus(profileId) {
  const state = getSubscriptionProfileState("openai-codex", profileId);
  const tokens = getCodexTokens(state);
  const accessToken = String(tokens?.access_token || "").trim();
  return {
    logged_in: Boolean(accessToken),
    access_expires_at: accessToken ? jwtExpiresAtIso(accessToken) : null,
    has_refresh_token: Boolean(tokens?.refresh_token),
  };
}

export async function resolveCodexSubscriptionCredential(profileId) {
  const id = String(profileId || "").trim();
  if (!id) throw new Error("Codex subscription requires x-webagent-profile-id.");
  const state = getSubscriptionProfileState("openai-codex", id);
  const tokens = getCodexTokens(state);
  if (!state || !tokens) {
    throw new Error("Codex subscription is not configured for this agent. Connect it in Edit profile.");
  }
  let accessToken = String(tokens.access_token || "").trim();
  let refreshToken = String(tokens.refresh_token || "").trim();
  if (!accessToken) {
    throw new Error("Codex subscription is missing an access token. Re-authenticate in Edit profile.");
  }
  if (codexAccessTokenExpiring(accessToken) && refreshToken) {
    const refreshed = await refreshCodexAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token;
    tokens.access_token = accessToken;
    tokens.refresh_token = refreshToken;
    if (refreshed.id_token) tokens.id_token = refreshed.id_token;
    state.tokens = tokens;
    state.last_refresh = new Date().toISOString();
    setSubscriptionProfileState("openai-codex", id, state);
  }
  const baseUrl = String(state.base_url || DEFAULT_CODEX_BASE_URL).replace(/\/$/, "");
  return { baseUrl, apiKey: accessToken };
}

export function persistCodexDeviceTokens(profileId, tokens) {
  setSubscriptionProfileState("openai-codex", profileId, {
    tokens,
    base_url: DEFAULT_CODEX_BASE_URL,
    last_refresh: new Date().toISOString(),
    auth_mode: "chatgpt",
    source: "device-code",
  });
}
