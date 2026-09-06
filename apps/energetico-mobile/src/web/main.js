import { PublicClientApplication } from "@azure/msal-browser";

import { APP_CONFIG } from "../config.js";
import { createAppController } from "../app-controller.js";
import { createChatClient } from "../chat/chat-client.js";
import { createConversationStore } from "../chat/conversation-store.js";
import { createChatView } from "../ui/chat-view.js";
import { createBrowserAuth } from "./browser-auth.js";
import { createBrowserPorts } from "./browser-ports.js";
import "../styles.css";

const root = globalThis.document?.querySelector("#app");

async function start() {
  if (!root) return;
  const msalClient = new PublicClientApplication({
    auth: {
      clientId: APP_CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${APP_CONFIG.tenantId}`,
      redirectUri: APP_CONFIG.webRedirectUri,
      postLogoutRedirectUri: APP_CONFIG.webRedirectUri,
      navigateToLoginRequestUrl: false,
    },
    cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false },
  });
  const auth = createBrowserAuth({ client: msalClient, config: APP_CONFIG });
  const controller = createAppController({
    auth,
    store: createConversationStore(),
    view: createChatView(root),
    native: createBrowserPorts(),
    client: createChatClient({
      apiBaseUrl: APP_CONFIG.apiBaseUrl,
      tokenProvider: scopes => auth.getToken(scopes),
    }),
  });
  await controller.start();
  globalThis.addEventListener?.("pagehide", () => controller.stop(), { once: true });
}

start().catch(() => {
  if (root) root.innerHTML = '<section class="auth-screen"><p class="error-banner" role="alert">O Energético não conseguiu iniciar. Atualize a página e tente novamente.</p></section>';
});

if (globalThis.navigator?.serviceWorker) {
  globalThis.addEventListener?.("load", () => {
    globalThis.navigator.serviceWorker.register("/energetico/service-worker.js", { scope: "/energetico/" });
  });
}
