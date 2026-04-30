// Register SW for production by default.
// Localhost can opt in for cache testing with ?sw=1 or localStorage.enableSW=1.
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

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        void registration.update();
      })
      .catch((err) => console.warn("SW registration failed:", err));
  });
}
