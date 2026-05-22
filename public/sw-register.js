// Register SW for production by default.
// Localhost can opt in for cache testing with ?sw=1 or localStorage.enableSW=1.
(function () {
  const SW_UPDATE_EVENT = "webagent:sw-update";
  const UPDATE_POLL_MS = 10 * 60 * 1000;

  function notifySwUpdate() {
    window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
  }

  function watchRegistration(registration) {
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (registration.waiting) notifySwUpdate();
      });
    });
    if (registration.waiting) notifySwUpdate();
  }

  if ("serviceWorker" in navigator) {
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

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        notifySwUpdate();
      });

      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          watchRegistration(registration);
          void registration.update();
          window.setInterval(() => {
            void registration.update();
          }, UPDATE_POLL_MS);
        })
        .catch((err) => console.warn("SW registration failed:", err));
    });
  }
})();
