import { APP_CONFIG } from "./config.js";
import "./styles.css";

const root = globalThis.document?.querySelector("#app");
if (root) {
  root.innerHTML = `<h1>${APP_CONFIG.appName}</h1><p>Falar com o Energético</p>`;
}
