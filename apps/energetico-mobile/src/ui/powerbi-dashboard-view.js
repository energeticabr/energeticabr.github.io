export const POWERBI_REPORT_ID = "188c0311-65d4-40f8-9bb9-02090f44a0fb";
export const POWERBI_EMBED_URL = `https://app.powerbi.com/reportEmbed?reportId=${POWERBI_REPORT_ID}`;
export const POWERBI_REPORT_URL = `https://app.powerbi.com/groups/me/reports/${POWERBI_REPORT_ID}?experience=power-bi`;

async function createPowerBiClient() {
  const sdkModule = await import("powerbi-client");
  const sdk = sdkModule.service?.Service ? sdkModule : sdkModule.default;
  if (!sdk?.service?.Service || !sdk?.factories || !sdk?.models) {
    throw new Error("A biblioteca de incorporação do Power BI não foi carregada.");
  }
  const service = new sdk.service.Service(
    sdk.factories.hpmFactory,
    sdk.factories.wpmpFactory,
    sdk.factories.routerFactory,
  );
  return {
    models: sdk.models,
    embed: service.embed.bind(service),
    reset: service.reset.bind(service),
  };
}

export function createPowerBiDashboardView({
  documentRef = globalThis.document,
  host = documentRef?.body,
  powerBiClient: suppliedPowerBiClient = null,
} = {}) {
  if (!documentRef?.createElement || !host?.append) {
    throw new TypeError("A tela do Power BI requer um documento e um contêiner válidos.");
  }

  let dialog = null;
  let returnFocus = null;
  let powerBiClient = suppliedPowerBiClient;
  let report = null;
  let reportContainer = null;
  let openRevision = 0;

  function close() {
    if (!dialog) return false;
    const current = dialog;
    dialog = null;
    openRevision += 1;
    report?.off?.("loaded", handleLoaded);
    report?.off?.("error", handleError);
    report = null;
    if (reportContainer) {
      try { powerBiClient?.reset?.(reportContainer); } catch { /* The DOM still closes if SDK cleanup fails. */ }
    }
    reportContainer = null;
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

  function handleLoaded() {
    if (dialog) dialog.querySelector(".powerbi-dashboard__hint").textContent = "Relatório conectado. Use as abas do Power BI para navegar.";
  }

  function handleError(event) {
    if (!dialog) return;
    const detail = event?.detail || event;
    const message = String(detail?.message || detail?.detailedMessage || "").trim();
    const hint = dialog.querySelector(".powerbi-dashboard__hint");
    hint.textContent = message
      ? `O Power BI não conseguiu carregar o relatório: ${message}`
      : "O Power BI não conseguiu carregar o relatório. Confira o acesso e a licença da conta Microsoft.";
  }

  async function open({ accessToken, getAccessToken } = {}) {
    if (dialog) return true;
    if (!String(accessToken || "").trim()) throw new TypeError("É necessário autenticar no Power BI antes de abrir o relatório.");
    if (typeof getAccessToken !== "function") throw new TypeError("A renovação segura do token do Power BI não está disponível.");

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
    hint.textContent = "Conectando ao relatório protegido com sua conta Microsoft…";

    const frameWrap = documentRef.createElement("div");
    frameWrap.className = "powerbi-dashboard__frame-wrap";
    reportContainer = documentRef.createElement("div");
    reportContainer.className = "powerbi-dashboard__report";
    reportContainer.setAttribute("aria-label", "Relatório Power BI ENERGÉTICA com todas as abas");
    frameWrap.append(reportContainer);
    dialog.append(header, hint, frameWrap);
    dialog.addEventListener("click", handleClick);
    documentRef.addEventListener?.("keydown", handleKeydown);
    host.append(dialog);
    closeButton.focus?.();

    const currentDialog = dialog;
    const revision = ++openRevision;
    try {
      powerBiClient ||= await createPowerBiClient();
      if (dialog !== currentDialog || openRevision !== revision) return false;
      report = powerBiClient.embed(reportContainer, {
        type: "report",
        id: POWERBI_REPORT_ID,
        embedUrl: POWERBI_EMBED_URL,
        accessToken,
        tokenType: powerBiClient.models.TokenType.Aad,
        eventHooks: {
          accessTokenProvider: async () => {
            const token = String(await getAccessToken() || "").trim();
            if (!token) throw new Error("Não foi possível renovar o token do Power BI.");
            return token;
          },
        },
      });
      report?.on?.("loaded", handleLoaded);
      report?.on?.("error", handleError);
      return true;
    } catch (error) {
      if (dialog === currentDialog && openRevision === revision) {
        hint.textContent = "Não foi possível incorporar o relatório. Confira a permissão Power BI da conta e tente novamente.";
      }
      throw error;
    }
  }

  return Object.freeze({
    open,
    close,
    destroy() { close(); },
  });
}
