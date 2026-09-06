const installButton = globalThis.document?.querySelector?.("[data-pwa-install]");
const iosHelp = globalThis.document?.querySelector?.("[data-pwa-ios-help]");
const iosClose = globalThis.document?.querySelector?.("[data-pwa-ios-close]");
const isIos = /iphone|ipad|ipod/i.test(globalThis.navigator?.userAgent || "");
const isStandalone = globalThis.matchMedia?.("(display-mode: standalone)")?.matches
  || globalThis.navigator?.standalone === true;
let installPrompt;

if ("serviceWorker" in (globalThis.navigator || {})) {
  globalThis.addEventListener?.("load", () => {
    void globalThis.navigator.serviceWorker.register("/portal-service-worker.js", { scope: "/" });
  });
}

if (installButton && !isStandalone && isIos) installButton.hidden = false;

globalThis.addEventListener?.("beforeinstallprompt", event => {
  event.preventDefault?.();
  installPrompt = event;
  if (installButton && !isStandalone) installButton.hidden = false;
});

installButton?.addEventListener?.("click", async () => {
  if (installPrompt) {
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = undefined;
    installButton.hidden = true;
    return;
  }
  if (isIos && iosHelp) iosHelp.hidden = false;
});

iosClose?.addEventListener?.("click", () => {
  if (iosHelp) iosHelp.hidden = true;
});

globalThis.addEventListener?.("appinstalled", () => {
  if (installButton) installButton.hidden = true;
  if (iosHelp) iosHelp.hidden = true;
});
