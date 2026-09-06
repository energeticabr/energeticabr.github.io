const CACHE_PREFIX = "energetica-portal-shell-";
const CACHE_NAME = "energetica-portal-shell-v7";
const APP_SHELL = [
  "/admin.html",
  "/manifest.webmanifest",
  "/portal/styles/admin.css",
  "/portal/pwa-register.js",
  "/assets/logo-energetica-oficial.png",
  "/assets/mascote-energetica-transparente.png",
  "/assets/icons/portal-192.png",
  "/assets/icons/portal-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function navigationResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put("/admin.html", response.clone());
    }
    return response;
  } catch {
    return caches.match("/admin.html", { ignoreSearch: true });
  }
}

async function staticResponse(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request)
      || await caches.match(new URL(request.url).pathname);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(url.pathname === "/admin.html" ? navigationResponse(request) : fetch(request));
    return;
  }
  if (url.pathname.startsWith("/portal/") || url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staticResponse(request));
  }
});
