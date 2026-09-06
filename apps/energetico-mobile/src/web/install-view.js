import { escapeHtml } from "../ui/escape-html.js";

const PREPARED_SHORTCUT_URL = "https://163-176-171-217.sslip.io/api/install-shortcut?v=4663F165";

export function isStandaloneDisplay({
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  navigatorRef = globalThis.navigator,
} = {}) {
  return Boolean(matchMedia?.("(display-mode: standalone)")?.matches || navigatorRef?.standalone === true);
}

export async function launchPreparedShortcut({
  token,
  shortcutUrl = PREPARED_SHORTCUT_URL,
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
} = {}) {
  const credential = String(token || "").trim();
  if (!credential) throw new Error("Crie a credencial primeiro.");
  if (!navigatorRef?.clipboard?.writeText) throw new Error("Não foi possível copiar a credencial neste navegador.");
  await navigatorRef.clipboard.writeText(credential);
  if (!locationRef?.assign) throw new Error("Não foi possível abrir o Atalho neste navegador.");
  locationRef.assign(shortcutUrl);
}

export function renderInstallMarkup(state = {}) {
  if (!state.open) {
    return "";
  }
  const install = state.standalone ? "" : `<section class="setup-section">
    <h3>Instalar o aplicativo no iPhone — grátis</h3>
    <p>Este é o aplicativo que abre diretamente o chatbot, sem prazo de validade e sem assinatura da Apple.</p>
    <p>Abra esta página no <strong>Safari</strong>, toque em <strong>Compartilhar</strong>, escolha <strong>Adicionar à Tela de Início</strong>, mantenha <strong>Abrir como App da Web</strong> ativado e confirme o nome <strong>ENERGÉTICO</strong>.</p>
    <p>Depois, abra sempre pelo ícone <strong>ENERGÉTICO</strong> com o mascote na Tela de Início.</p>
  </section>`;
  const sharing = !state.standalone ? "" : state.token ? `<section class="setup-section setup-secret">
    <h3>Credencial criada</h3>
    <p>Copie agora. Ela aparece somente nesta tela e funciona como uma senha.</p>
    <code data-role="shortcut-token">${escapeHtml(state.token)}</code>
    <button type="button" data-tool-action="copy-token">Copiar credencial</button>
    <h4>Ative o compartilhamento de arquivos</h4>
    <p>Este Atalho é somente para aparecer na <strong>Folha de Compartilhamento</strong>. Não adicione este Atalho à Tela de Início; o ícone <strong>ENERGÉTICO</strong> com o mascote abre o chatbot.</p>
    <p>Toque no botão abaixo. A credencial será copiada e o iPhone abrirá o Atalho <strong>ENERGÉTICO</strong> já configurado. Cole a credencial na única pergunta e toque em <strong>Adicionar Atalho</strong>. Se o iPhone pedir, substitua a versão antiga.</p>
    <p>Na Folha de Compartilhamento, o Atalho envia várias fotos ou arquivos de uma vez. Ao final, ele abre a conversa no navegador. Para conversar em tela cheia, toque no mascote na Tela de Início.</p>
    <a class="primary-button setup-link" data-tool-action="install-shortcut" href="${PREPARED_SHORTCUT_URL}">Instalar compartilhamento ENERGÉTICO</a>
    <button class="danger-button" type="button" data-tool-action="revoke">Revogar credencial</button>
  </section>` : !state.ready ? `<section class="setup-section"><h3>Compartilhamento</h3><p>Entre com a Microsoft para consultar sua configuração.</p></section>`
    : state.checking ? `<section class="setup-section"><h3>Compartilhamento</h3><p role="status">Consultando sua credencial…</p></section>`
    : state.credentialStatus === "active" && !state.reconfigure ? `<section class="setup-section">
    <h3>Credencial de compartilhamento ativa</h3>
    <p>Você já criou uma credencial. Se o Atalho já está configurado no iPhone, não é necessário configurá-lo novamente.</p>
    <p>Feche esta janela para continuar conversando. Para enviar arquivos, use o ENERGÉTICO na Folha de Compartilhamento.</p>
    <button type="button" data-tool-action="reconfigure">Preciso configurar outro Atalho</button>
    <button class="danger-button" type="button" data-tool-action="revoke"${state.busy ? " disabled" : ""}>Revogar credencial</button>
  </section>` : state.credentialStatus === "inactive" || state.reconfigure ? `<section class="setup-section">
    <h3>Configurar compartilhamento</h3>
    <p>${state.reconfigure ? "Criar outra credencial invalida a credencial atual. Depois, será necessário atualizar o Atalho do iPhone com a nova credencial." : "Crie uma credencial exclusiva para encaminhar fotos e arquivos ao Energético pela Folha de Compartilhamento."}</p>
    <button class="primary-button" type="button" data-tool-action="issue"${state.ready && !state.busy ? "" : " disabled"}>${state.busy ? "Criando…" : state.ready ? "Criar credencial" : "Entre com a Microsoft primeiro"}</button>
  </section>` : `<section class="setup-section">
    <h3>Compartilhamento</h3><p>Não foi possível confirmar o estado da sua credencial. Nenhuma configuração foi alterada.</p>
    <button type="button" data-tool-action="refresh-status">Consultar novamente</button>
  </section>`;
  return `<div class="setup-backdrop" data-tool-action="close"></div>
    <section class="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <header><h2 id="setup-title">Energético no iPhone</h2><button type="button" data-tool-action="close" aria-label="Fechar">×</button></header>
      ${state.error ? `<p class="error-banner" role="alert">${escapeHtml(state.error)}</p>` : ""}
      ${state.notice ? `<p class="setup-notice" role="status">${escapeHtml(state.notice)}</p>` : ""}
      ${install}${sharing}
    </section>`;
}

export function createInstallView(root, {
  client,
  navigatorRef = globalThis.navigator,
  locationRef = globalThis.location,
  standalone = isStandaloneDisplay({ navigatorRef }),
} = {}) {
  if (!root?.addEventListener || !client) throw new TypeError("O assistente de instalação requer uma raiz e um cliente.");
  let state = {
    open: false,
    standalone,
    ready: false,
    busy: false,
    token: "",
    uploadUrl: "",
    error: "",
    notice: "",
    credentialStatus: null,
    checking: false,
    reconfigure: false,
  };
  let generation = 0;
  let destroyed = false;
  let lastMarkup;

  function render(next = {}) {
    state = { ...state, ...next };
    const markup = renderInstallMarkup(state);
    if (markup !== lastMarkup) root.innerHTML = markup;
    lastMarkup = markup;
  }

  async function refreshStatus() {
    if (destroyed || !state.open || !state.standalone || !state.ready || state.busy || state.token) return;
    const request = ++generation;
    render({ checking: true, credentialStatus: null, reconfigure: false, error: "" });
    try {
      const result = await client.status();
      if (request !== generation || destroyed) return;
      if (!["active", "inactive"].includes(result?.status)) throw new Error("A VM não devolveu uma confirmação válida.");
      render({ checking: false, credentialStatus: result.status });
    } catch (error) {
      if (request === generation && !destroyed) render({ checking: false, error: error?.message || "Não foi possível consultar sua credencial." });
    }
  }

  async function click(event) {
    const target = event.target?.closest?.("[data-tool-action]");
    if (!target) return;
    const action = target.dataset.toolAction;
    if (action === "close") {
      return render({ open: false, reconfigure: false, error: "", notice: "" });
    }
    if (action === "refresh-status") return refreshStatus();
    if (action === "reconfigure" && state.credentialStatus === "active" && !state.busy) return render({ reconfigure: true });
    if (action === "copy-token" && state.token) {
      const request = generation;
      try {
        if (!navigatorRef.clipboard?.writeText) throw new Error("Não foi possível copiar a credencial neste navegador.");
        await navigatorRef.clipboard.writeText(state.token);
        if (request === generation && !destroyed) render({ notice: "Credencial copiada." });
      } catch (error) {
        if (request === generation && !destroyed) render({ error: error?.message || "Não foi possível copiar a credencial." });
      }
      return;
    }
    if (action === "install-shortcut" && state.token) {
      event.preventDefault?.();
      try {
        await launchPreparedShortcut({ token: state.token, navigatorRef, locationRef });
      } catch (error) {
        return render({ error: error?.message || "Não foi possível abrir o Atalho pronto." });
      }
      return;
    }
    if (action === "issue" && state.ready && !state.busy && !state.checking && (state.credentialStatus === "inactive" || state.reconfigure)) {
      const request = ++generation;
      render({ busy: true, error: "", notice: "", token: "", uploadUrl: "" });
      try {
        const result = await client.issue();
        if (request !== generation || destroyed) return;
        render({ busy: false, token: result.token, uploadUrl: result.uploadUrl, credentialStatus: "active", reconfigure: false });
      } catch (error) {
        if (request === generation && !destroyed) render({ busy: false, credentialStatus: null, reconfigure: false, error: error?.message || "Não foi possível criar a credencial." });
      }
    }
    if (action === "revoke" && state.ready && !state.busy && state.credentialStatus === "active") {
      const request = ++generation;
      render({ busy: true, error: "", notice: "" });
      try {
        await client.revoke();
        if (request !== generation || destroyed) return;
        render({ busy: false, token: "", uploadUrl: "", credentialStatus: "inactive", reconfigure: false, notice: "Credencial revogada." });
      } catch (error) {
        if (request === generation && !destroyed) render({ busy: false, error: error?.message || "Não foi possível revogar a credencial." });
      }
    }
  }

  root.addEventListener("click", click);
  render();
  return Object.freeze({
    async open() {
      if (destroyed) return;
      render({ open: true });
      await refreshStatus();
    },
    setReady(ready) {
      if (destroyed) return;
      if (!ready) {
        generation += 1;
        render({ ready: false, open: false, busy: false, checking: false, credentialStatus: null, reconfigure: false, token: "", uploadUrl: "", error: "", notice: "" });
      } else {
        render({ ready: true });
        if (state.open) void refreshStatus();
      }
    },
    destroy() { destroyed = true; generation += 1; root.removeEventListener("click", click); root.innerHTML = ""; state.token = ""; },
  });
}
