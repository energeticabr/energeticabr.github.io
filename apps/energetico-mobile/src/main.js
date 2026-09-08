import { APP_CONFIG } from "./config.js";
import { createAppController } from "./app-controller.js";
import { createAuthService } from "./auth/auth-service.js";
import { createChatClient } from "./chat/chat-client.js";
import { createConversationStore } from "./chat/conversation-store.js";
import { createNativePorts } from "./native/native-ports.js";
import { MicrosoftAuth } from "./native/plugins.js";
import { createChatView } from "./ui/chat-view.js";
import "./styles.css";

const root = globalThis.document?.querySelector("#app");
if (root) {
  try {
    const auth = createAuthService(MicrosoftAuth, APP_CONFIG);
    const store = createConversationStore({ historyMode: "current-step" });
    const controller = createAppController({
      auth,
      store,
      view: createChatView(root),
      native: createNativePorts(),
      client: createChatClient({
        apiBaseUrl: APP_CONFIG.apiBaseUrl,
        tokenProvider: scopes => auth.getToken(scopes),
      }),
    });
    controller.start();
    // Native appStateChange imports shared files on return. A transient webview
    // pagehide must not permanently stop the controller and its native listener.
  } catch {
    root.replaceChildren();
    const section = globalThis.document.createElement("section");
    section.className = "auth-screen";
    const message = globalThis.document.createElement("p");
    message.className = "error-banner";
    message.setAttribute("role", "alert");
    message.textContent = "O Energético não conseguiu iniciar. Feche e abra o aplicativo novamente.";
    section.append(message);
    root.append(section);
  }
}
