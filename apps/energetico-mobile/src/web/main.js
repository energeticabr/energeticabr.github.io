import { PublicClientApplication } from "@azure/msal-browser";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

import { APP_CONFIG } from "../config.js";
import { createAppController } from "../app-controller.js";
import { createPendingConstructionDiaryData } from "../chat/pending-construction-diary-data.js";
import { createChatClient } from "../chat/chat-client.js";
import { createConversationStore } from "../chat/conversation-store.js";
import { createChatView } from "../ui/chat-view.js";
import { createBrowserAuth } from "./browser-auth.js";
import { createBrowserPorts } from "./browser-ports.js";
import { createAttachmentPreview } from "./attachment-preview.js";
import { bindAttachmentSync } from "./attachment-sync.js";
import { bindPageLifecycle } from "./page-lifecycle.js";
import { createRecoveryStorage } from "./recovery-storage.js";
import { createInstallView } from "./install-view.js";
import { bridgeMicrosoftAuthResponse } from "./redirect-bridge.js";
import { createShortcutClient } from "./shortcut-client.js";
import "../styles.css";
import "../ui/supplier-payroll.css";
import "../ui/launch-gallery.css";
import "../ui/searchable-filter-selects.css";
import "../ui/gallery-record-actions.css";
import "../ui/hr-payroll-gallery.css";
import "../ui/orders-gallery.css";
import "../ui/orders-linked-report.css";
import "../ui/tasks-gallery.css";
import "../ui/contractor-reports.css";
import "../ui/rh-reports.css";
import "../ui/operations-reports.css";
import "../ui/spending-reports.css";
import "../ui/payment-ledger.css";
import "../ui/provision-report.css";
import "../ui/order-validation-report.css";
import "../ui/management-report.css";
import "../ui/cargos.css";
import "../ui/attendance-summary.css";
import "../ui/stage-progress.css";
import "../ui/supplier-payroll-report.css";
import "../ui/commercial-receipts.css";
import "../ui/commercial-milestones.css";
import "../ui/commercial-documents.css";
import "../ui/sac-pathologies.css";
import "../ui/quotation-report.css";
import "../ui/depreciation-report.css";
import "../ui/document-control-report.css";
import "../ui/task-association-report.css";
import "../ui/delegated-deadline-report.css";
import "../ui/pending-work-diaries-report.css";
import "../ui/audit-reports-live.css";
import "../ui/commercial-progress-reports.css";
import "../ui/commercial-docs-rent-reports-style.css";
import "../ui/registration-gallery.css";
import "./attachment-preview.css";

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
  const ports = createBrowserPorts();
  const preview = createAttachmentPreview({ exportMedia: ports.exportMedia });
  const client = createChatClient({
    apiBaseUrl: APP_CONFIG.apiBaseUrl,
    tokenProvider: scopes => auth.getToken(scopes),
  });
  const view = createChatView(root, {
    onOpenSettings: installView ? () => installView.open() : undefined,
    ensureMicrophonePermission: ports.requestMicrophonePermission,
    transcribeAudio: file => client.transcribeAudio(file),
  });
  view.on("sign-out", () => installView?.setReady(false));
  const controller = createAppController({
    auth,
    recovery: createRecoveryStorage(),
    store: createConversationStore({ historyMode: "current-step" }),
    view,
    native: { ...ports, previewMedia: preview.open, previewMediaCollection: preview.openCollection, closePreview: preview.close },
    client,
    pendingConstructionDiaryDataFactory: createPendingConstructionDiaryData,
  });
  // Bind before the first network await: iOS may hide/kill the page while resuming.
  let stopAttachmentSync = () => {};
  bindPageLifecycle({
    onSave: () => {
      controller.flushRecovery();
      controller.handleBackground();
    },
    onRestore: () => {
      controller.handleForeground();
      return controller.refreshAttachments({ silent: true });
    },
    onClose: () => {
      controller.stop();
      stopAttachmentSync();
      preview.destroy();
      installView?.destroy();
    },
  });
  await controller.start();
  stopAttachmentSync = bindAttachmentSync({ refresh: controller.refreshAttachments });
  installView?.setReady(Boolean(auth.getAccount()));
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
    globalThis.navigator.serviceWorker.register("/energetico/service-worker.js?v=5", { scope: "/energetico/" });
  });
}
