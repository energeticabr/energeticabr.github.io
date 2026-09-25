export const POWERBI_REPORT_ID = "188c0311-65d4-40f8-9bb9-02090f44a0fb";
export const POWERBI_EMBED_URL = `https://app.powerbi.com/reportEmbed?reportId=${POWERBI_REPORT_ID}&autoAuth=true`;
export const POWERBI_REPORT_URL = `https://app.powerbi.com/groups/me/reports/${POWERBI_REPORT_ID}?experience=power-bi`;

export function createPowerBiDashboardView({ documentRef = globalThis.document, host = documentRef?.body } = {}) {
  if (!documentRef?.createElement || !host?.append) {
    throw new TypeError("A tela do Power BI requer um documento e um contêiner válidos.");
  }

  let dialog = null;
  let returnFocus = null;

  function close() {
    if (!dialog) return false;
    const current = dialog;
    dialog = null;
    current.removeEventListener("click", handleClick);
    documentRef.removeEventListener?.("keydown", handleKeydown);
    current.remove();
    returnFocus?.focus?.();
    returnFocus = null;
    return true;
  }

  function handleClick(event) {
    if (event.target?.closest?.("[data-powerbi-close]")) close();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") close();
  }

  function open() {
    if (dialog) return true;
    returnFocus = documentRef.activeElement;
    dialog = documentRef.createElement("section");
    dialog.className = "powerbi-dashboard";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "Painel Power BI ENERGÉTICA");
    dialog.tabIndex = -1;

    const header = documentRef.createElement("header");
    header.className = "powerbi-dashboard__header";
    const closeButton = documentRef.createElement("button");
    closeButton.type = "button";
    closeButton.dataset.powerbiClose = "true";
    closeButton.className = "powerbi-dashboard__back";
    closeButton.setAttribute("aria-label", "Voltar para a conversa");
    closeButton.textContent = "‹";
    const heading = documentRef.createElement("div");
    heading.className = "powerbi-dashboard__heading";
    const title = documentRef.createElement("h1");
    title.textContent = "📊 POWER BI";
    const subtitle = documentRef.createElement("p");
    subtitle.textContent = "ENERGÉTICA · relatório com todas as abas";
    heading.append(title, subtitle);
    const directLink = documentRef.createElement("a");
    directLink.className = "powerbi-dashboard__direct-link";
    directLink.href = POWERBI_REPORT_URL;
    directLink.target = "_blank";
    directLink.rel = "noopener noreferrer";
    directLink.textContent = "Abrir no Power BI";
    header.append(closeButton, heading, directLink);

    const hint = documentRef.createElement("p");
    hint.className = "powerbi-dashboard__hint";
    hint.setAttribute("role", "status");
    hint.textContent = "Relatório protegido do Meu workspace. Se solicitado, entre com sua conta Microsoft; as permissões do Power BI continuam valendo.";

    const frameWrap = documentRef.createElement("div");
    frameWrap.className = "powerbi-dashboard__frame-wrap";
    const frame = documentRef.createElement("iframe");
    frame.className = "powerbi-dashboard__frame";
    frame.src = POWERBI_EMBED_URL;
    frame.title = "Relatório Power BI ENERGÉTICA com todas as abas";
    frame.allowFullscreen = true;
    frame.setAttribute("allow", "fullscreen");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frameWrap.append(frame);
    dialog.append(header, hint, frameWrap);
    dialog.addEventListener("click", handleClick);
    documentRef.addEventListener?.("keydown", handleKeydown);
    host.append(dialog);
    closeButton.focus?.();
    return true;
  }

  return Object.freeze({
    open,
    close,
    destroy() { close(); },
  });
}
