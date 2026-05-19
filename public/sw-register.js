// Register SW for production by default.
// Localhost can opt in for cache testing with ?sw=1 or localStorage.enableSW=1.
if ("serviceWorker" in navigator) {
  let reloadOnControllerChange = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadOnControllerChange) return;
    reloadOnControllerChange = false;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    const host = window.location.hostname;
    const isLocalhost =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    const params = new URLSearchParams(window.location.search);
    const swQuery = params.get("sw");
    const localOverride = window.localStorage.getItem("enableSW") === "1";
    const localhostOptIn = swQuery === "1" || localOverride;

    if (isLocalhost && !localhostOptIn) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (registration.waiting) {
          reloadOnControllerChange = true;
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              reloadOnControllerChange = true;
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
        void registration.update();
      })
      .catch((err) => console.warn("SW registration failed:", err));
  });

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLScriptElement)) return;
      if (target.type !== "module" && !target.src.endsWith(".js")) return;
      if (sessionStorage.getItem("sw-chunk-reload") === "1") return;
      sessionStorage.setItem("sw-chunk-reload", "1");
      window.location.reload();
    },
    true
  );
}
