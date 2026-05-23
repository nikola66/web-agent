import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function envValue(name) {
  return String(process.env[name] || "").trim();
}

export function normalizeProfileId(value) {
  return String(value || "").trim();
}

function getHermesAuthFilePath() {
  const hermesHome = envValue("HERMES_HOME");
  return path.join(hermesHome || path.join(os.homedir(), ".hermes"), "auth.json");
}

export function readHermesAuthStore() {
  const authFile = getHermesAuthFilePath();
  if (!fs.existsSync(authFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(authFile, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeHermesAuthStore(authStore) {
  const authFile = getHermesAuthFilePath();
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  fs.writeFileSync(authFile, `${JSON.stringify(authStore, null, 2)}\n`, "utf8");
  try {
    fs.chmodSync(authFile, 0o600);
  } catch {
    /* best-effort */
  }
}

function getSubscriptionProfilesRecord(authStore, providerKey) {
  const providers = authStore.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return {};
  const bucket = providers[providerKey];
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return {};
  if ("access_token" in bucket) return {};
  return bucket;
}

function getSubscriptionProvidersWritable(providers, providerKey) {
  const existing = providers[providerKey];
  if (
    existing &&
    typeof existing === "object" &&
    !Array.isArray(existing) &&
    !("access_token" in existing) &&
    !("tokens" in existing)
  ) {
    return { ...existing };
  }
  return {};
}

export function getSubscriptionProfileState(providerKey, profileId) {
  const id = normalizeProfileId(profileId);
  if (!id) return null;
  const record = getSubscriptionProfilesRecord(readHermesAuthStore(), providerKey);
  const state = record[id];
  return state && typeof state === "object" ? { ...state } : null;
}

export function setSubscriptionProfileState(providerKey, profileId, state) {
  const id = normalizeProfileId(profileId);
  if (!id) return;
  const authStore = readHermesAuthStore();
  const providers =
    authStore.providers && typeof authStore.providers === "object" && !Array.isArray(authStore.providers)
      ? authStore.providers
      : {};
  const profiles = getSubscriptionProvidersWritable(providers, providerKey);
  profiles[id] = state;
  authStore.providers = { ...providers, [providerKey]: profiles };
  writeHermesAuthStore(authStore);
}

export function deleteSubscriptionProfileState(providerKey, profileId) {
  const id = normalizeProfileId(profileId);
  if (!id) return;
  const authStore = readHermesAuthStore();
  const providers =
    authStore.providers && typeof authStore.providers === "object" && !Array.isArray(authStore.providers)
      ? authStore.providers
      : {};
  const profiles = getSubscriptionProvidersWritable(providers, providerKey);
  delete profiles[id];
  authStore.providers = { ...providers, [providerKey]: profiles };
  writeHermesAuthStore(authStore);
}

export function parseIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

export function isExpiring(expiresAt, skewSeconds) {
  const ts = parseIsoTimestamp(expiresAt);
  if (ts == null) return true;
  return ts <= Date.now() + Math.max(0, skewSeconds) * 1000;
}

export function decodeJwtClaims(token) {
  if (typeof token !== "string") return {};
  const parts = token.split(".");
  if (parts.length !== 3) return {};
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : {};
  } catch {
    return {};
  }
}

export function tokenHasScope(token, scope) {
  const claims = decodeJwtClaims(token);
  const rawScope = claims.scope;
  if (typeof rawScope === "string") {
    return rawScope.split(/\s+/).includes(scope);
  }
  const rawScopes = claims.scopes;
  return Array.isArray(rawScopes) && rawScopes.includes(scope);
}

export function jwtExpiresAtIso(token, fallbackExpiresAt) {
  const claims = decodeJwtClaims(token);
  const exp = claims.exp;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    return new Date(exp * 1000).toISOString();
  }
  return typeof fallbackExpiresAt === "string" ? fallbackExpiresAt : null;
}
