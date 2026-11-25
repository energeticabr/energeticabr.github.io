import { APP_CONFIG } from "../config.js";

const PRIVATE_HOSTS = new Set([
  new URL(APP_CONFIG.apiBaseUrl).hostname,
  "163-176-171-217.sslip.io",
  "login.microsoftonline.com",
  "graph.microsoft.com",
]);

export function shouldCacheRequest(request) {
  if (request?.method !== "GET") return false;
  const url = new URL(request.url);
  if (PRIVATE_HOSTS.has(url.hostname)) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return url.origin === "https://www.energeticabr.com"
    && url.pathname.startsWith("/energetico/");
}
