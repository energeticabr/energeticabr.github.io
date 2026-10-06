import { APP_CONFIG } from "./config.js";
import { createAuthService } from "./auth/auth-service.js";
import { createNativeBootstrap } from "./demo/native-bootstrap.js";
import { createNativePorts } from "./native/native-ports.js";
import { MicrosoftAuth } from "./native/plugins.js";
import "./styles.css";
import "./ui/supplier-payroll.css";
import "./ui/launch-gallery.css";
import "./ui/searchable-filter-selects.css";
import "./ui/orders-gallery.css";
import "./ui/orders-linked-report.css";
import "./ui/registration-gallery.css";
import "./ui/hr-payroll-gallery.css";
import "./ui/gallery-record-actions.css";
import "./ui/tasks-gallery.css";
import "./ui/contractor-reports.css";
import "./ui/rh-reports.css";
import "./ui/operations-reports.css";
import "./ui/spending-reports.css";
import "./ui/payment-ledger.css";
import "./ui/management-report.css";
import "./ui/cargos.css";
import "./ui/provision-report.css";
import "./ui/order-validation-report.css";
import "./ui/attendance-summary.css";
import "./ui/stage-progress.css";
import "./ui/commercial-receipts.css";
import "./ui/commercial-milestones.css";
import "./ui/commercial-documents.css";
import "./ui/sac-pathologies.css";
import "./ui/quotation-report.css";
import "./ui/depreciation-report.css";
import "./ui/document-control-report.css";
import "./ui/audit-reports-live.css";
import "./ui/commercial-progress-reports.css";
import "./ui/commercial-docs-rent-reports-style.css";
import "./demo/demo.css";
import "./web/attachment-preview.css";

const root = globalThis.document?.querySelector("#app");
if (root) {
  try {
    const auth = createAuthService(MicrosoftAuth, APP_CONFIG);
    const controller = createNativeBootstrap({ root, auth, config: APP_CONFIG, native: createNativePorts() });
    controller.start();
    // Native appStateChange imports shared files on return. A transient webview
    // pagehide must not permanently stop the controller and its native listener.
    globalThis.addEventListener?.("pagehide", () => {
      controller.flushRecovery();
      controller.handleBackground();
    });
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
