if ("serviceWorker" in (globalThis.navigator || {})) {
  globalThis.addEventListener?.("load", () => {
    void globalThis.navigator.serviceWorker.register("/portal-service-worker.js", { scope: "/" });
  });
}
