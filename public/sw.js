/** @type {ServiceWorkerGlobalScope} */
const sw = self;

const CACHE_NAME = "web-agent-v6";

const PRECACHE = [
  "/sw-register.js",
  "/mascot/Webby-blue.svg",
  "/mascot/Webby-green.svg",
  "/mascot/Webby-maroon.svg",
  "/mascot/Webby-navy.svg",
  "/mascot/Webby-orange.svg",
  "/mascot/Webby-pink.svg",
];

const CACHEABLE_PATH_RE =
  /\.(?:js|css|html|ico|png|jpg|jpeg|svg|webp|woff2?|ttf|json|map)$/i;

function isCacheableRequest(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin !== sw.location.origin) return false;
  return CACHEABLE_PATH_RE.test(url.pathname);
}

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function isAppShellRequest(url) {
  return url.pathname === "/" || url.pathname === "/index.html";
}

function isScriptRequest(url) {
  return /\.(?:js|mjs)(?:\?|$)/i.test(url.pathname);
}

function isBadScriptResponse(response) {
  const type = response.headers.get("content-type") || "";
  return type.includes("text/html");
}

async function networkFirst(request, cache, { offlineFallback } = {}) {
  try {
    const response = await fetch(request);
    if (response.ok && !(isScriptRequest(new URL(request.url)) && isBadScriptResponse(response))) {
      void cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (offlineFallback) {
      const fallback =
        (await cache.match("/index.html")) ?? (await cache.match("/"));
      if (fallback) return fallback;
    }
    throw new Error(`Request failed and no cache entry found: ${new URL(request.url).pathname}`);
  }
}

sw.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  sw.skipWaiting();
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
  );
  sw.clients.claim();
});

sw.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    sw.skipWaiting();
  }
});

sw.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const cacheable = isCacheableRequest(event.request, url);
  const isNavigation = isNavigationRequest(event.request);
  if (!cacheable && !isNavigation) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const useNetworkFirst =
        isNavigation || isAppShellRequest(url) || isScriptRequest(url);

      if (useNetworkFirst) {
        return networkFirst(event.request, cache, {
          offlineFallback: isNavigation || isAppShellRequest(url),
        });
      }

      const cached = await cache.match(event.request);
      const networkPromise = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            void cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        void networkPromise;
        return cached;
      }

      const response = await networkPromise;
      if (response) return response;

      throw new Error(`Request failed and no cache entry found: ${url.pathname}`);
    })()
  );
});
