import providers from "../shared/subscription-providers.json";

export const SUBSCRIPTION_OAUTH_PROVIDER_IDS = providers as readonly string[];
export type SubscriptionOAuthProviderId = (typeof SUBSCRIPTION_OAUTH_PROVIDER_IDS)[number];

export type SubscriptionAuthStatus = {
  logged_in: boolean;
  portal_base_url?: string | null;
  inference_base_url?: string | null;
  access_expires_at?: string | null;
  agent_key_expires_at?: string | null;
  has_refresh_token?: boolean;
};

export type SubscriptionAuthResult =
  | { ok: true; status: SubscriptionAuthStatus }
  | { ok: false; status: SubscriptionAuthStatus; error: string; offline?: boolean };

export type DeviceOAuthSession = {
  session_id: string;
  user_code: string;
  verification_url: string;
  poll_interval?: number;
};

export type OAuthPollResult =
  | { ok: true; status: "approved" | "pending"; retry_after?: number }
  | { ok: false; error: string };

const AUTH_CACHE_TTL_MS = 30_000;
const authCache = new Map<
  string,
  { status: SubscriptionAuthStatus; fetchedAt: number; offline?: boolean }
>();

function cacheKey(providerId: string, profileId: string) {
  return `${providerId}:${profileId}`;
}

export function isSubscriptionOAuthProvider(id: string): id is SubscriptionOAuthProviderId {
  return (SUBSCRIPTION_OAUTH_PROVIDER_IDS as readonly string[]).includes(id);
}

export function isSubscriptionLlmUrl(url: string): boolean {
  return SUBSCRIPTION_OAUTH_PROVIDER_IDS.some((id) => url.includes(`/api/llm/${id}/`));
}

export function invalidateSubscriptionAuthCache(profileId?: string) {
  if (!profileId) {
    authCache.clear();
    return;
  }
  for (const key of authCache.keys()) {
    if (key.endsWith(`:${profileId}`)) authCache.delete(key);
  }
}

export async function fetchSubscriptionAuthStatus(
  providerId: SubscriptionOAuthProviderId,
  profileId: string,
  options: { force?: boolean } = {}
): Promise<SubscriptionAuthResult> {
  const id = profileId.trim();
  if (!id) return { ok: true, status: { logged_in: false } };
  const key = cacheKey(providerId, id);
  const cached = authCache.get(key);
  if (!options.force && cached && Date.now() - cached.fetchedAt < AUTH_CACHE_TTL_MS) {
    if (cached.offline) {
      return { ok: false, status: cached.status, error: "Auth status unavailable", offline: true };
    }
    return { ok: true, status: cached.status };
  }
  try {
    const res = await fetch(
      `/api/providers/oauth/${encodeURIComponent(providerId)}/status?profile_id=${encodeURIComponent(id)}`
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const status = (await res.json()) as SubscriptionAuthStatus;
    authCache.set(key, { status, fetchedAt: Date.now() });
    return { ok: true, status };
  } catch (error) {
    const status = cached?.status ?? { logged_in: false };
    const message = error instanceof Error ? error.message : String(error);
    authCache.set(key, { status, fetchedAt: Date.now(), offline: true });
    return { ok: false, status, error: message, offline: true };
  }
}

export async function startSubscriptionOAuth(
  providerId: SubscriptionOAuthProviderId,
  profileId: string
): Promise<DeviceOAuthSession> {
  const res = await fetch(`/api/providers/oauth/${encodeURIComponent(providerId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile_id: profileId.trim() }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(payload.error || payload.message || `status ${res.status}`));
  }
  return {
    session_id: String(payload.session_id || ""),
    user_code: String(payload.user_code || ""),
    verification_url: String(payload.verification_url || ""),
    poll_interval: Number(payload.poll_interval || 2),
  };
}

export async function pollSubscriptionOAuth(
  providerId: SubscriptionOAuthProviderId,
  sessionId: string
): Promise<OAuthPollResult> {
  const res = await fetch(
    `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: String(payload.message || payload.error || `status ${res.status}`) };
  }
  const status = String(payload.status || "");
  if (status === "approved") return { ok: true, status: "approved" };
  if (status === "pending") {
    return {
      ok: true,
      status: "pending",
      retry_after: Number(payload.retry_after || payload.poll_interval || 2),
    };
  }
  return { ok: false, error: String(payload.message || `OAuth ${status || "failed"}`) };
}

export async function logoutSubscriptionProfile(
  providerId: SubscriptionOAuthProviderId,
  profileId: string
): Promise<void> {
  const id = profileId.trim();
  if (!id) return;
  const res = await fetch(`/api/providers/oauth/${encodeURIComponent(providerId)}/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile_id: id }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(String(payload.error || payload.message || `status ${res.status}`));
  }
  invalidateSubscriptionAuthCache(id);
}
