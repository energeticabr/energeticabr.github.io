const MASCOT_URL = new URL("../assets/mascote.png", import.meta.url).href;

export function createMascotReportButton(documentRef, { label, action = "open-report", onActivate } = {}) {
  const accessibleLabel = String(label || "").trim();
  const actionName = String(action || "").trim();
  if (!documentRef?.createElement || !accessibleLabel || !actionName || typeof onActivate !== "function") {
    throw new TypeError("O botão de relatório requer documento, rótulo acessível e ação.");
  }

  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "report-mascot-button";
  button.dataset.action = actionName;
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
  const mascot = documentRef.createElement("img");
  mascot.src = MASCOT_URL;
  mascot.alt = "";
  mascot.setAttribute("aria-hidden", "true");
  mascot.draggable = false;
  button.append(mascot);
  button.addEventListener("click", onActivate);
  return button;
}
