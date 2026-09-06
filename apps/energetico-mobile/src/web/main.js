import { PublicClientApplication } from "@azure/msal-browser";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

import { APP_CONFIG } from "../config.js";
import { createAppController } from "../app-controller.js";
import { createChatClient } from "../chat/chat-client.js";
import { createConversationStore } from "../chat/conversation-store.js";
import { createChatView } from "../ui/chat-view.js";
import { createBrowserAuth } from "./browser-auth.js";
import { createBrowserPorts } from "./browser-ports.js";
import { createInstallView } from "./install-view.js";
import { bridgeMicrosoftAuthResponse } from "./redirect-bridge.js";
import { createShortcutClient } from "./shortcut-client.js";
import "../styles.css";

const root = globalThis.document?.querySelector("#app");
const toolsRoot = globalThis.document?.querySelector("#app-tools");

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
  const installView = toolsRoot ? createInstallView(toolsRoot, {
    client: createShortcutClient({
      apiBaseUrl: APP_CONFIG.apiBaseUrl,
      tokenProvider: scopes => auth.getToken(scopes),
    }),
  }) : null;
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
  installView?.setReady(Boolean(auth.getAccount()));
  globalThis.addEventListener?.("pagehide", () => {
    controller.stop();
    installView?.destroy();
  }, { once: true });
}

async function bootstrap() {
  const bridged = await bridgeMicrosoftAuthResponse({
    broadcastResponse: () => broadcastResponseToMainFrame(),
  });
  if (!bridged) await start();
}

bootstrap().catch(() => {
  if (root) root.innerHTML = '<section class="auth-screen"><p class="error-banner" role="alert">O Energético não conseguiu iniciar. Atualize a página e tente novamente.</p></section>';
});

if (globalThis.navigator?.serviceWorker) {
  globalThis.addEventListener?.("load", () => {
    globalThis.navigator.serviceWorker.register("/energetico/service-worker.js", { scope: "/energetico/" });
  });
}
