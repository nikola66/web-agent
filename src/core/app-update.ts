import { clearCacheStorage, unregisterServiceWorkers } from "./persistence";

export const UPDATE_DISMISS_STORAGE_KEY = "webagent.update.dismissedBuildId";
export const SW_UPDATE_EVENT = "webagent:sw-update";

const POLL_INTERVAL_MS = 10 * 60 * 1000;

export type RemoteVersion = { version: string; buildId: string };

type UpdateState = {
  available: boolean;
  remoteBuildId: string | null;
};

let state: UpdateState = { available: false, remoteBuildId: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function setState(next: UpdateState): void {
  state = next;
  emit();
}

export function getAppUpdateSnapshot(): UpdateState {
  return state;
}

export function subscribeAppUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isUpdateCheckEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  const isLocalhost =
    host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLocalhost) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get("checkUpdates") === "1") return true;
  try {
    return window.localStorage.getItem("enableUpdateCheck") === "1";
  } catch {
    return false;
  }
}

export function isUpdateDismissed(remoteBuildId: string): boolean {
  try {
    return sessionStorage.getItem(UPDATE_DISMISS_STORAGE_KEY) === remoteBuildId;
  } catch {
    return false;
  }
}

export function dismissAppUpdate(remoteBuildId: string): void {
  try {
    sessionStorage.setItem(UPDATE_DISMISS_STORAGE_KEY, remoteBuildId);
  } catch {
    /* private mode */
  }
  emit();
}

export function shouldShowUpdateNotice(): boolean {
  if (!state.available || !state.remoteBuildId) return false;
  return !isUpdateDismissed(state.remoteBuildId);
}

export function compareBuildIds(
  localBuildId: string,
  remote: RemoteVersion | null,
): boolean {
  if (!remote?.buildId) return false;
  return remote.buildId !== localBuildId;
}

export async function fetchRemoteVersion(): Promise<RemoteVersion | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<RemoteVersion>;
    if (typeof data.buildId !== "string" || !data.buildId) return null;
    return {
      version: typeof data.version === "string" ? data.version : "",
      buildId: data.buildId,
    };
  } catch {
    return null;
  }
}

export async function checkForAppUpdate(): Promise<boolean> {
  if (!isUpdateCheckEnabled()) return false;
  const localBuildId = import.meta.env.VITE_APP_BUILD_ID;
  const remote = await fetchRemoteVersion();
  const available = compareBuildIds(localBuildId, remote);
  setState({
    available,
    remoteBuildId: available && remote ? remote.buildId : null,
  });
  return available;
}

export function prepareUpdateReloadUrl(
  href: string,
  refreshTs: string | number = Date.now(),
): string {
  const url = new URL(href);
  url.searchParams.set("_refresh", String(refreshTs));
  url.searchParams.delete("clean");
  return url.toString();
}

export async function reloadForAppUpdate(): Promise<void> {
  await unregisterServiceWorkers();
  await clearCacheStorage();
  window.location.replace(prepareUpdateReloadUrl(window.location.href));
}

let checkerStarted = false;

export function startAppUpdateChecker(): void {
  if (checkerStarted || typeof window === "undefined") return;
  checkerStarted = true;
  if (!isUpdateCheckEnabled()) return;

  void checkForAppUpdate();

  window.setInterval(() => {
    void checkForAppUpdate();
  }, POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkForAppUpdate();
  });

  window.addEventListener(SW_UPDATE_EVENT, () => {
    void checkForAppUpdate();
  });
}
