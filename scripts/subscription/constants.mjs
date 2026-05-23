import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const providersPath = path.resolve(__dirname, "../../src/shared/subscription-providers.json");
export const SUBSCRIPTION_OAUTH_PROVIDER_IDS = JSON.parse(fs.readFileSync(providersPath, "utf8"));
export const SUBSCRIPTION_OAUTH_PROVIDERS = new Set(SUBSCRIPTION_OAUTH_PROVIDER_IDS);

export function isSubscriptionProvider(id) {
  return SUBSCRIPTION_OAUTH_PROVIDERS.has(String(id || "").trim());
}

export const DEFAULT_NOUS_PORTAL_URL = "https://portal.nousresearch.com";
export const DEFAULT_NOUS_INFERENCE_URL = "https://inference-api.nousresearch.com/v1";
export const NOUS_LEGACY_AGENT_KEY_SCOPE = "inference:mint_agent_key";
export const NOUS_INFERENCE_INVOKE_SCOPE = "inference:invoke";
export const DEFAULT_NOUS_SCOPE = `${NOUS_INFERENCE_INVOKE_SCOPE} ${NOUS_LEGACY_AGENT_KEY_SCOPE}`;
export const NOUS_INVOKE_JWT_MIN_TTL_SECONDS = 120;
export const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 120;
export const DEFAULT_AGENT_KEY_MIN_TTL_SECONDS = 30 * 60;
export const OAUTH_SESSION_TTL_SECONDS = 15 * 60;
export const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
